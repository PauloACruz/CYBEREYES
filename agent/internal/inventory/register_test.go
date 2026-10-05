package inventory

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/vmihailenco/msgpack/v5"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/bus"
	"github.com/pauloacruz/cybereyes/agent/internal/config"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// fakePub guarda os check-ins ja codificados e decodificados de volta (como o servidor ve).
type fakePub struct {
	mu   sync.Mutex
	conn bool
	msgs map[string][]map[string]any
}

func (p *fakePub) Checkin(kind string, body any) error {
	data, err := bus.Encode(body)
	if err != nil {
		return err
	}
	var m map[string]any
	if err := msgpack.Unmarshal(data, &m); err != nil {
		return err
	}
	p.mu.Lock()
	p.msgs[kind] = append(p.msgs[kind], m)
	p.mu.Unlock()
	return nil
}

func (p *fakePub) Publish(string, any) error { return nil }

func (p *fakePub) Connected() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.conn
}

func (p *fakePub) count(kind string) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.msgs[kind])
}

func (p *fakePub) last(kind string) map[string]any {
	p.mu.Lock()
	defer p.mu.Unlock()
	l := p.msgs[kind]
	if len(l) == 0 {
		return nil
	}
	return l[len(l)-1]
}

func waitFor(t *testing.T, d time.Duration, cond func() bool, what string) {
	t.Helper()
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("tempo esgotado esperando %s", what)
}

func TestRegisterCheckins(t *testing.T) {
	const agentID = "abcdefghijabcdefghijabcdefghijabcdefghij"
	var mu sync.Mutex
	hits := map[string]int{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		hits[r.Method+" "+r.URL.Path]++
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v3/" + agentID + "/config/":
			_, _ = io.WriteString(w, `{"checkin_hello":40,"checkin_agentinfo":250,"checkin_winsvc":2500,"checkin_pubip":350,"checkin_disks":1200,"checkin_sw":3000,"checkin_wmi":3200,"limit_data":false,"install_nushell_url":""}`)
		case "/ip":
			_, _ = io.WriteString(w, "203.0.113.7\n")
		default:
			_, _ = io.WriteString(w, `"ok"`)
		}
	}))
	defer srv.Close()
	old := publicIPServices
	publicIPServices = []string{srv.URL + "/ip"}
	defer func() { publicIPServices = old }()

	client, err := api.New(srv.URL, "token", api.Options{})
	if err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pub := &fakePub{msgs: map[string][]map[string]any{}}
	e := &env.Env{Cfg: &config.Config{API: srv.URL, AgentID: agentID, Token: "token"}, API: client, Pub: pub,
		Reg: rpc.NewRegistry(log), Log: log, Ctx: ctx, Refresh: func() {}}
	if err := Register(e); err != nil {
		t.Fatal(err)
	}

	// Sem conexao nada e publicado; ao conectar, os check-ins saem em segundos.
	time.Sleep(1500 * time.Millisecond)
	if pub.count(kindHello) != 0 {
		t.Fatal("publicou sem conexao")
	}
	pub.mu.Lock()
	pub.conn = true
	pub.mu.Unlock()
	for _, k := range []string{kindHello, kindAgentInfo, kindDisks, kindPublicIP, kindWMI} {
		k := k
		waitFor(t, 20*time.Second, func() bool { return pub.count(k) > 0 }, k)
		if pub.last(k)["agent_id"] != agentID {
			t.Errorf("%s sem agent_id: %#v", k, pub.last(k))
		}
	}

	hello := pub.last(kindHello)
	if _, ok := hello["version"].(string); !ok {
		t.Errorf("hello.version = %#v", hello["version"])
	}
	info := pub.last(kindAgentInfo)
	if info["plat"] != runtime.GOOS || info["goarch"] != runtime.GOARCH {
		t.Errorf("plat/goarch = %#v", info)
	}
	for _, k := range []string{"operating_system", "logged_in_username", "hostname"} {
		if s, ok := info[k].(string); !ok || s == "" {
			t.Errorf("agentinfo.%s = %#v", k, info[k])
		}
	}
	if _, ok := info["needs_reboot"].(bool); !ok {
		t.Errorf("needs_reboot = %#v", info["needs_reboot"])
	}
	if _, ok := info["total_ram"].(float64); !ok {
		t.Errorf("total_ram deve ser float: %#v", info["total_ram"])
	}
	if _, ok := info["boot_time"].(string); ok {
		t.Error("boot_time nao pode ser texto")
	}
	disks, ok := pub.last(kindDisks)["disks"].([]any)
	if !ok {
		t.Fatalf("disks = %#v", pub.last(kindDisks))
	}
	for _, d := range disks {
		m := d.(map[string]any)
		for _, k := range []string{"device", "fstype", "total", "used", "free"} {
			if _, ok := m[k].(string); !ok {
				t.Errorf("disco.%s = %#v", k, m[k])
			}
		}
		if _, ok := m["percent"].(string); ok {
			t.Error("percent deve ser numero")
		}
	}
	if ip := pub.last(kindPublicIP)["public_ip"]; ip != "203.0.113.7" {
		t.Errorf("public_ip = %#v", ip)
	}
	wmiMap, ok := pub.last(kindWMI)["wmi"].(map[string]any)
	if !ok {
		t.Fatalf("wmi = %#v", pub.last(kindWMI))
	}
	if runtime.GOOS != "windows" {
		for _, k := range []string{"cpus", "gpus", "disks", "local_ips"} {
			if _, ok := wmiMap[k].([]any); !ok {
				t.Errorf("wmi.%s deve ser lista: %#v", k, wmiMap[k])
			}
		}
		if _, ok := wmiMap["make_model"].(string); !ok {
			t.Errorf("wmi.make_model = %#v", wmiMap["make_model"])
		}
	}

	t.Logf("agentinfo: %v", info)
	t.Logf("disks: %v", disks)
	t.Logf("wmi: %v", wmiMap)

	// sysinfo responde "ok" e reenvia agentinfo; e.Refresh faz o mesmo.
	before := pub.count(kindAgentInfo)
	if r := e.Reg.Dispatch(ctx, rpc.Request{"func": "sysinfo"}); r != "ok" {
		t.Fatalf("sysinfo = %#v", r)
	}
	waitFor(t, 10*time.Second, func() bool { return pub.count(kindAgentInfo) > before }, "agentinfo apos sysinfo")
	before = pub.count(kindDisks)
	e.Refresh()
	waitFor(t, 10*time.Second, func() bool { return pub.count(kindDisks) > before }, "disks apos Refresh")

	// POST checkin depois de conectar, e config buscada.
	waitFor(t, 15*time.Second, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return hits["POST /api/v3/checkin/"] == 1 && hits["GET /api/v3/"+agentID+"/config/"] >= 1
	}, "checkin e config")
	mu.Lock()
	if hits["POST /api/v3/choco/"] != 0 && runtime.GOOS != "windows" {
		t.Error("choco so no Windows")
	}
	mu.Unlock()

	// softwarelist devolve lista (ou erro em texto quando a maquina nao tem gerenciador conhecido).
	reply := e.Reg.Dispatch(ctx, rpc.Request{"func": "softwarelist"})
	data, err := bus.Encode(reply)
	if err != nil {
		t.Fatal(err)
	}
	var decoded any
	if err := msgpack.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	switch v := decoded.(type) {
	case []any:
		t.Logf("softwarelist: %d itens", len(v))
		if len(v) > 0 {
			t.Logf("primeiro: %v", v[0])
			m := v[0].(map[string]any)
			for _, k := range []string{"name", "version", "publisher", "install_date", "size", "source", "location", "uninstall"} {
				if _, ok := m[k].(string); !ok {
					t.Errorf("software.%s = %#v", k, m[k])
				}
			}
		}
	case string:
		t.Logf("softwarelist: %s", v)
	default:
		t.Fatalf("softwarelist = %#v", decoded)
	}
}
