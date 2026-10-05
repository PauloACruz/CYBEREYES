package snmp

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gosnmp/gosnmp"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// fakeAgent e um agente SNMP v2c minimo (GET, GETNEXT e GETBULK) sobre uma tabela fixa.
type fakeAgent struct {
	conn      *net.UDPConn
	community string
	table     []gosnmp.SnmpPDU
}

func oidLess(a, b string) bool {
	pa, pb := strings.Split(normOID(a), "."), strings.Split(normOID(b), ".")
	for i := 0; i < len(pa) && i < len(pb); i++ {
		x, _ := strconv.Atoi(pa[i])
		y, _ := strconv.Atoi(pb[i])
		if x != y {
			return x < y
		}
	}
	return len(pa) < len(pb)
}

func startFakeAgent(t *testing.T, community string, table []gosnmp.SnmpPDU) int {
	t.Helper()
	sort.Slice(table, func(i, j int) bool { return oidLess(table[i].Name, table[j].Name) })
	conn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	a := &fakeAgent{conn: conn, community: community, table: table}
	t.Cleanup(func() { conn.Close() })
	go a.serve()
	return conn.LocalAddr().(*net.UDPAddr).Port
}

func (a *fakeAgent) next(oid string) gosnmp.SnmpPDU {
	for _, p := range a.table {
		if oidLess(oid, p.Name) {
			return p
		}
	}
	return gosnmp.SnmpPDU{Name: oid, Type: gosnmp.EndOfMibView}
}

func (a *fakeAgent) serve() {
	buf := make([]byte, 65535)
	dec := &gosnmp.GoSNMP{Version: gosnmp.Version2c}
	for {
		n, from, err := a.conn.ReadFromUDP(buf)
		if err != nil {
			return
		}
		req, err := dec.SnmpDecodePacket(buf[:n])
		if err != nil || req.Community != a.community {
			continue
		}
		var vars []gosnmp.SnmpPDU
		switch req.PDUType {
		case gosnmp.GetRequest:
			for _, v := range req.Variables {
				found := gosnmp.SnmpPDU{Name: v.Name, Type: gosnmp.NoSuchObject}
				for _, p := range a.table {
					if normOID(p.Name) == normOID(v.Name) {
						found = p
					}
				}
				vars = append(vars, found)
			}
		case gosnmp.GetNextRequest:
			for _, v := range req.Variables {
				vars = append(vars, a.next(v.Name))
			}
		case gosnmp.GetBulkRequest:
			reps := int(req.MaxRepetitions)
			if reps == 0 {
				reps = 10
			}
			cur := make([]string, len(req.Variables))
			for i, v := range req.Variables {
				cur[i] = v.Name
			}
			for r := 0; r < reps; r++ {
				for i := range cur {
					p := a.next(cur[i])
					vars = append(vars, p)
					cur[i] = p.Name
				}
			}
		default:
			continue
		}
		resp := &gosnmp.SnmpPacket{Version: gosnmp.Version2c, Community: a.community, PDUType: gosnmp.GetResponse,
			RequestID: req.RequestID, Variables: vars}
		out, err := resp.MarshalMsg()
		if err != nil {
			continue
		}
		_, _ = a.conn.WriteToUDP(out, from)
	}
}

func pdu(oid string, typ gosnmp.Asn1BER, v any) gosnmp.SnmpPDU {
	return gosnmp.SnmpPDU{Name: oid, Type: typ, Value: v}
}

func switchTable() []gosnmp.SnmpPDU {
	t := []gosnmp.SnmpPDU{
		pdu(oidSysDescr, gosnmp.OctetString, "Switch de teste"),
		pdu(oidSysObjectID, gosnmp.ObjectIdentifier, ".1.3.6.1.4.1.9.1.1"),
		pdu(oidSysUpTime, gosnmp.TimeTicks, uint32(123456)),
		pdu(oidSysContact, gosnmp.OctetString, "noc@exemplo"),
		pdu(oidSysName, gosnmp.OctetString, "sw01"),
		pdu(oidSysLocation, gosnmp.OctetString, "rack 1"),
		pdu(".1.3.6.1.4.1.9999.1.0", gosnmp.Integer, 42),
		pdu(".1.3.6.1.4.1.9999.2.0", gosnmp.OctetString, "23.5"),
		pdu(".1.3.6.1.4.1.9999.3.0", gosnmp.OctetString, "Toner OK"),
		pdu(".1.3.6.1.4.1.9999.5.0", gosnmp.Gauge32, uint32(7)),
	}
	for _, i := range []int{1, 2} {
		s := "." + strconv.Itoa(i)
		speed := uint32(4294967295)
		if i == 2 {
			speed = 100_000_000
		}
		t = append(t,
			pdu(ifTable+".1"+s, gosnmp.Integer, i),
			pdu(ifTable+".2"+s, gosnmp.OctetString, "eth"+strconv.Itoa(i-1)),
			pdu(ifTable+".3"+s, gosnmp.Integer, 6),
			pdu(ifTable+".5"+s, gosnmp.Gauge32, speed),
			pdu(ifTable+".7"+s, gosnmp.Integer, 1),
			pdu(ifTable+".8"+s, gosnmp.Integer, i),
			pdu(ifTable+".10"+s, gosnmp.Counter32, uint32(1000*i)),
			pdu(ifTable+".14"+s, gosnmp.Counter32, uint32(5*(i-1))),
			pdu(ifTable+".16"+s, gosnmp.Counter32, uint32(3000*i)),
			pdu(ifTable+".20"+s, gosnmp.Counter32, uint32(0)),
			pdu(ifXTable+".1"+s, gosnmp.OctetString, "Gi0/"+strconv.Itoa(i)),
			pdu(ifXTable+".15"+s, gosnmp.Gauge32, uint32(map[int]uint32{1: 10000, 2: 100}[i])),
			pdu(ifXTable+".18"+s, gosnmp.OctetString, map[int]string{1: "uplink", 2: ""}[i]),
		)
	}
	// Contadores de 64 bits so na interface 1.
	t = append(t,
		pdu(ifXTable+".6.1", gosnmp.Counter64, uint64(1)<<40),
		pdu(ifXTable+".10.1", gosnmp.Counter64, uint64(1)<<41),
	)
	return t
}

func target(port int) Target {
	return Target{ID: 7, Host: "127.0.0.1", Port: port, Version: "v2c", Community: "public", Interval: 60, Timeout: 1, Retries: 0,
		Interfaces: true, Sensors: []Sensor{
			{ID: 1, OID: "1.3.6.1.4.1.9999.1.0"},
			{ID: 2, OID: ".1.3.6.1.4.1.9999.2.0"},
			{ID: 3, OID: ".1.3.6.1.4.1.9999.3.0"},
			{ID: 4, OID: ".1.3.6.1.4.1.9999.4.0"},
			{ID: 5, OID: "abc"},
			{ID: 6, OID: ".1.3.6.1.4.1.9999.5.0"},
		}}
}

func TestPollAgainstFakeAgent(t *testing.T) {
	port := startFakeAgent(t, "public", switchTable())
	at := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	res := pollTarget(context.Background(), dial, target(port), at)
	if !res.Reachable || res.Error != nil || res.DeviceID != 7 || res.Time != "2026-10-05T12:00:00Z" {
		t.Fatalf("resultado = %+v", res)
	}
	sys := res.System
	if sys == nil || sys.Descr != "Switch de teste" || sys.ObjectID != "1.3.6.1.4.1.9.1.1" || sys.UptimeTicks != 123456 ||
		sys.Name != "sw01" || sys.Contact != "noc@exemplo" || sys.Location != "rack 1" {
		t.Fatalf("system = %+v", sys)
	}
	if len(res.Interfaces) != 2 {
		t.Fatalf("interfaces = %+v", res.Interfaces)
	}
	i1, i2 := res.Interfaces[0], res.Interfaces[1]
	if i1.Index != 1 || i1.Name != "Gi0/1" || i1.Descr != "eth0" || i1.Alias != "uplink" || i1.Type != 6 ||
		i1.SpeedBps != 10_000_000_000 || i1.AdminStatus != 1 || i1.OperStatus != 1 || !i1.HC ||
		*i1.InOctets != uint64(1)<<40 || *i1.OutOctets != uint64(1)<<41 || *i1.InErrors != 0 {
		t.Fatalf("if1 = %+v", i1)
	}
	if i2.Index != 2 || i2.HC || *i2.InOctets != 2000 || *i2.OutOctets != 6000 || i2.SpeedBps != 100_000_000 ||
		i2.OperStatus != 2 || *i2.InErrors != 5 {
		t.Fatalf("if2 = %+v", i2)
	}
	sensors := map[int]SensorValue{}
	for _, s := range res.Sensors {
		sensors[s.ID] = s
	}
	if v := sensors[1].Value; v == nil || *v != 42 {
		t.Fatalf("sensor 1 = %+v", sensors[1])
	}
	if v := sensors[2].Value; v == nil || *v != 23.5 {
		t.Fatalf("sensor 2 = %+v", sensors[2])
	}
	if s := sensors[3]; s.Value != nil || s.Text == nil || *s.Text != "Toner OK" {
		t.Fatalf("sensor 3 = %+v", s)
	}
	if s := sensors[4]; s.Value != nil || s.Text == nil || *s.Text != "NoSuchObject" {
		t.Fatalf("sensor 4 = %+v", s)
	}
	if s := sensors[5]; s.Value != nil || s.Text == nil || !strings.Contains(*s.Text, "OID invalido") {
		t.Fatalf("sensor 5 = %+v", s)
	}
	if v := sensors[6].Value; v == nil || *v != 7 {
		t.Fatalf("sensor 6 = %+v", sensors[6])
	}

	// O JSON segue o contrato.
	data, _ := json.Marshal(res)
	var m map[string]any
	_ = json.Unmarshal(data, &m)
	for _, k := range []string{"device_id", "time", "reachable", "error", "rtt_ms", "system", "interfaces", "sensors"} {
		if _, ok := m[k]; !ok {
			t.Errorf("chave %s ausente em %s", k, data)
		}
	}
	ifs := m["interfaces"].([]any)[0].(map[string]any)
	for _, k := range []string{"index", "name", "descr", "alias", "type", "speed_bps", "admin_status", "oper_status", "in_octets", "out_octets", "in_errors", "out_errors", "hc"} {
		if _, ok := ifs[k]; !ok {
			t.Errorf("chave %s ausente na interface", k)
		}
	}
	if !strings.Contains(string(data), `"in_octets":1099511627776`) {
		t.Errorf("contador de 64 bits sem precisao: %s", data)
	}
}

func TestPollUnreachable(t *testing.T) {
	port := startFakeAgent(t, "public", switchTable())
	tg := target(port)
	tg.Community = "errada"
	res := pollTarget(context.Background(), dial, tg, time.Now())
	if res.Reachable || res.Error == nil || res.System != nil || res.Interfaces != nil || res.Sensors != nil {
		t.Fatalf("resultado = %+v", res)
	}
	data, _ := json.Marshal(res)
	if !strings.Contains(string(data), `"reachable":false`) || !strings.Contains(string(data), `"system":null`) {
		t.Fatalf("json = %s", data)
	}
}

func TestSnmpTestCommand(t *testing.T) {
	port := startFakeAgent(t, "public", switchTable())
	c := newCollector(nil, "AGENTE", slog.New(slog.NewTextHandler(io.Discard, nil)))
	raw, _ := json.Marshal(map[string]any{"host": "127.0.0.1", "port": port, "version": "v2c", "community": "public",
		"v3": nil, "interval": 300, "timeout": 1, "retries": 0, "interfaces": true, "sensors": []any{}})
	reply := c.handleTest(context.Background(), rpc.Request{"func": "snmp_test", "payload": map[string]any{"target": string(raw)}})
	s, ok := reply.(string)
	if !ok {
		t.Fatalf("resposta nao e string: %T", reply)
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(s), &got); err != nil {
		t.Fatalf("resposta %q: %v", s, err)
	}
	if got["reachable"] != true || got["error"] != nil {
		t.Fatalf("resposta = %s", s)
	}
	if _, ok := got["rtt_ms"].(float64); !ok {
		t.Fatalf("rtt_ms = %v", got["rtt_ms"])
	}
	sys := got["system"].(map[string]any)
	if sys["name"] != "sw01" || sys["object_id"] != "1.3.6.1.4.1.9.1.1" || sys["uptime_ticks"] != float64(123456) {
		t.Fatalf("system = %v", sys)
	}

	// Comunidade errada: alcancavel falso com o erro.
	raw, _ = json.Marshal(map[string]any{"host": "127.0.0.1", "port": port, "version": "v2c", "community": "x", "timeout": 1, "retries": 0})
	s = c.handleTest(context.Background(), rpc.Request{"payload": map[string]any{"target": string(raw)}}).(string)
	if err := json.Unmarshal([]byte(s), &got); err != nil || got["reachable"] != false || got["error"] == nil || got["system"] != nil {
		t.Fatalf("resposta = %s", s)
	}

	// Alvo invalido: texto comecando com error.
	for _, bad := range []string{"", "{", `{"host":""}`, `{"host":"h","version":"v9"}`, `{"host":"h","version":"v3"}`} {
		r := c.handleTest(context.Background(), rpc.Request{"payload": map[string]any{"target": bad}}).(string)
		if !strings.HasPrefix(r, "error") {
			t.Errorf("alvo %q: %s", bad, r)
		}
	}
}

func TestParseTargetAndV3Params(t *testing.T) {
	tg, err := ParseTarget(`{"host":" 10.0.0.1 ","port":0,"version":"v3","community":"","interval":5,"timeout":0,"retries":-1,
		"v3":{"username":"mon","security_level":"authPriv","auth_protocol":"SHA512","auth_password":"a1234567","priv_protocol":"AES256","priv_password":"p1234567"},
		"sensors":[{"id":3,"oid":".1.3.6"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if tg.Host != "10.0.0.1" || tg.Port != 161 || tg.Interval != 60 || tg.Timeout != 5 || tg.Retries != 0 || tg.Sensors[0].ID != 3 {
		t.Fatalf("alvo = %+v", tg)
	}
	g, err := tg.params(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	usm := g.SecurityParameters.(*gosnmp.UsmSecurityParameters)
	if g.Version != gosnmp.Version3 || g.MsgFlags != gosnmp.AuthPriv || g.SecurityModel != gosnmp.UserSecurityModel ||
		usm.UserName != "mon" || usm.AuthenticationProtocol != gosnmp.SHA512 || usm.PrivacyProtocol != gosnmp.AES256 ||
		usm.AuthenticationPassphrase != "a1234567" || usm.PrivacyPassphrase != "p1234567" {
		t.Fatalf("params = %+v usm = %+v", g, usm)
	}
	cases := []struct {
		level, auth, priv string
		flags             gosnmp.SnmpV3MsgFlags
		ap                gosnmp.SnmpV3AuthProtocol
		pp                gosnmp.SnmpV3PrivProtocol
	}{
		{"noAuthNoPriv", "", "", gosnmp.NoAuthNoPriv, gosnmp.NoAuth, gosnmp.NoPriv},
		{"authNoPriv", "MD5", "", gosnmp.AuthNoPriv, gosnmp.MD5, gosnmp.NoPriv},
		{"authNoPriv", "SHA256", "", gosnmp.AuthNoPriv, gosnmp.SHA256, gosnmp.NoPriv},
		{"authPriv", "SHA", "DES", gosnmp.AuthPriv, gosnmp.SHA, gosnmp.DES},
		{"authPriv", "SHA", "AES", gosnmp.AuthPriv, gosnmp.SHA, gosnmp.AES},
		{"authPriv", "", "", gosnmp.AuthPriv, gosnmp.SHA, gosnmp.AES},
	}
	for _, c := range cases {
		tg.V3 = &V3{Username: "u", SecurityLevel: c.level, AuthProtocol: c.auth, AuthPassword: "x", PrivProtocol: c.priv, PrivPassword: "y"}
		g, err := tg.params(context.Background())
		if err != nil {
			t.Fatalf("%+v: %v", c, err)
		}
		usm := g.SecurityParameters.(*gosnmp.UsmSecurityParameters)
		if g.MsgFlags != c.flags || usm.AuthenticationProtocol != c.ap || usm.PrivacyProtocol != c.pp {
			t.Errorf("%+v: flags=%v auth=%v priv=%v", c, g.MsgFlags, usm.AuthenticationProtocol, usm.PrivacyProtocol)
		}
	}
	tg.V3 = &V3{Username: "u", SecurityLevel: "authPriv", AuthProtocol: "XYZ"}
	if _, err := tg.params(context.Background()); err == nil {
		t.Error("protocolo desconhecido aceito")
	}
	v2, err := ParseTarget(`{"host":"h","version":"v2c","community":"c","interval":99999}`)
	if err != nil || v2.Interval != 3600 {
		t.Fatalf("v2c = %+v %v", v2, err)
	}
	g, _ = v2.params(context.Background())
	if g.Version != gosnmp.Version2c || g.Community != "c" || g.Port != 161 {
		t.Fatalf("params v2c = %+v", g)
	}
}

func freeUDPPort(t *testing.T) int {
	t.Helper()
	c, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	port := c.LocalAddr().(*net.UDPAddr).Port
	c.Close()
	return port
}

func sendTraps(t *testing.T, port int) {
	t.Helper()
	v2 := &gosnmp.GoSNMP{Target: "127.0.0.1", Port: uint16(port), Community: "public", Version: gosnmp.Version2c, Timeout: time.Second}
	if err := v2.Connect(); err != nil {
		t.Fatal(err)
	}
	defer v2.Close()
	_, err := v2.SendTrap(gosnmp.SnmpTrap{Variables: []gosnmp.SnmpPDU{
		{Name: ".1.3.6.1.2.1.1.3.0", Type: gosnmp.TimeTicks, Value: uint32(500)},
		{Name: ".1.3.6.1.6.3.1.1.4.1.0", Type: gosnmp.ObjectIdentifier, Value: ".1.3.6.1.6.3.1.1.5.3"},
		{Name: ".1.3.6.1.2.1.2.2.1.1.2", Type: gosnmp.Integer, Value: 2},
		{Name: ".1.3.6.1.2.1.2.2.1.2.2", Type: gosnmp.OctetString, Value: "eth1"},
		{Name: ".1.3.6.1.2.1.2.2.1.6.2", Type: gosnmp.OctetString, Value: []byte{0x00, 0x1a, 0x2b, 0x3c, 0x4d, 0x5e}},
		{Name: ".1.3.6.1.2.1.31.1.1.1.6.2", Type: gosnmp.Counter64, Value: uint64(1) << 50},
	}})
	if err != nil {
		t.Fatal(err)
	}
	v1 := &gosnmp.GoSNMP{Target: "127.0.0.1", Port: uint16(port), Community: "comunidade-v1", Version: gosnmp.Version1, Timeout: time.Second}
	if err := v1.Connect(); err != nil {
		t.Fatal(err)
	}
	defer v1.Close()
	_, err = v1.SendTrap(gosnmp.SnmpTrap{Enterprise: ".1.3.6.1.4.1.9999", AgentAddress: "127.0.0.1", GenericTrap: 6, SpecificTrap: 17,
		Variables: []gosnmp.SnmpPDU{{Name: ".1.3.6.1.4.1.9999.1.0", Type: gosnmp.OctetString, Value: "porta aberta"}}})
	if err != nil {
		t.Fatal(err)
	}
}

// fakeServer simula as rotas SNMP do servidor.
type fakeServer struct {
	mu      sync.Mutex
	cfg     Config
	results [][]map[string]any
	traps   [][]map[string]any
	fail    int
}

func (s *fakeServer) handler(t *testing.T) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v3/AGENTE/snmp/":
			_ = json.NewEncoder(w).Encode(s.cfg)
		case r.Method == http.MethodPost && (r.URL.Path == "/api/v3/snmp/results/" || r.URL.Path == "/api/v3/snmp/traps/"):
			if s.fail > 0 {
				s.fail--
				w.WriteHeader(http.StatusBadGateway)
				return
			}
			var body map[string][]map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if r.URL.Path == "/api/v3/snmp/results/" {
				if len(body["results"]) > 1000 {
					t.Errorf("lote com %d resultados", len(body["results"]))
				}
				s.results = append(s.results, body["results"])
			} else {
				s.traps = append(s.traps, body["traps"])
			}
			_, _ = w.Write([]byte(`"ok"`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
}

func newTestCollector(t *testing.T, cfg Config) (*collector, *fakeServer) {
	t.Helper()
	srv := &fakeServer{cfg: cfg}
	hs := httptest.NewServer(srv.handler(t))
	t.Cleanup(hs.Close)
	cl, err := api.New(hs.URL, "tok", api.Options{})
	if err != nil {
		t.Fatal(err)
	}
	c := newCollector(cl, "AGENTE", slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(func() { c.apply(Config{}) })
	return c, srv
}

func TestCollectorPollsAndRetriesResults(t *testing.T) {
	port := startFakeAgent(t, "public", switchTable())
	tg := target(port)
	c, srv := newTestCollector(t, Config{Enabled: true, TrapPort: 0, Devices: []Target{tg}})
	ctx := context.Background()
	c.refresh(ctx)
	if len(c.devices) != 1 {
		t.Fatalf("dispositivos = %d", len(c.devices))
	}
	c.devices[7].next = time.Time{}
	c.schedule(ctx)
	c.wg.Wait()
	if c.devices[7].running || !c.devices[7].next.After(time.Now().Add(50*time.Second)) {
		t.Fatalf("reagendamento = %+v", c.devices[7])
	}

	srv.fail = 1
	c.flush(ctx)
	if len(c.results) != 1 || len(srv.results) != 0 {
		t.Fatalf("resultado nao retido apos falha: %d", len(c.results))
	}
	c.flush(ctx)
	if len(c.results) != 0 || len(srv.results) != 1 || srv.results[0][0]["device_id"] != float64(7) || srv.results[0][0]["reachable"] != true {
		t.Fatalf("enviados = %v", srv.results)
	}

	// Muitos resultados: lotes de ate 1000.
	for i := 0; i < 2500; i++ {
		c.addResult(Result{DeviceID: 7, Time: time.Now().UTC().Format(time.RFC3339Nano)})
	}
	c.flush(ctx)
	if len(srv.results) != 4 || len(srv.results[1]) != 1000 || len(srv.results[3]) != 500 {
		t.Fatalf("lotes = %d", len(srv.results))
	}

	// Desligado: dispositivos removidos e nenhuma coleta.
	srv.cfg = Config{Enabled: false, TrapPort: 162}
	c.refresh(ctx)
	if len(c.devices) != 0 || c.trap != nil {
		t.Fatalf("coletor desligado ainda tem %d dispositivos", len(c.devices))
	}
}

func TestTrapListenerForwardsTraps(t *testing.T) {
	port := freeUDPPort(t)
	c, srv := newTestCollector(t, Config{Enabled: true, TrapPort: port})
	c.trapAddr = "127.0.0.1:" + strconv.Itoa(port)
	ctx := context.Background()
	c.refresh(ctx)
	if !c.trap.alive() {
		t.Fatal("receptor de traps nao iniciou")
	}
	sendTraps(t, port)
	deadline := time.Now().Add(3 * time.Second)
	for {
		c.mu.Lock()
		n := len(c.traps)
		c.mu.Unlock()
		if n >= 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("traps recebidos: %d", n)
		}
		time.Sleep(20 * time.Millisecond)
	}
	c.flush(ctx)
	if len(srv.traps) != 1 || len(srv.traps[0]) != 2 {
		t.Fatalf("traps enviados = %v", srv.traps)
	}
	byVersion := map[string]map[string]any{}
	for _, tr := range srv.traps[0] {
		byVersion[tr["version"].(string)] = tr
	}
	v2 := byVersion["v2c"]
	if v2 == nil || v2["source_ip"] != "127.0.0.1" || v2["community"] != "public" || v2["trap_oid"] != "1.3.6.1.6.3.1.1.5.3" {
		t.Fatalf("trap v2c = %v", v2)
	}
	if _, err := time.Parse(time.RFC3339, v2["time"].(string)); err != nil {
		t.Fatalf("hora = %v", v2["time"])
	}
	vbs := v2["varbinds"].([]any)
	if len(vbs) != 4 {
		t.Fatalf("varbinds = %v", vbs)
	}
	want := []struct {
		oid, typ string
		value    any
	}{
		{"1.3.6.1.2.1.2.2.1.1.2", "Integer", float64(2)},
		{"1.3.6.1.2.1.2.2.1.2.2", "OctetString", "eth1"},
		{"1.3.6.1.2.1.2.2.1.6.2", "OctetString", "00:1a:2b:3c:4d:5e"},
		{"1.3.6.1.2.1.31.1.1.1.6.2", "Counter64", float64(uint64(1) << 50)},
	}
	for i, w := range want {
		vb := vbs[i].(map[string]any)
		if vb["oid"] != w.oid || vb["type"] != w.typ || vb["value"] != w.value {
			t.Errorf("varbind %d = %v, esperado %+v", i, vb, w)
		}
	}
	v1 := byVersion["v1"]
	if v1 == nil || v1["community"] != "comunidade-v1" || v1["trap_oid"] != "1.3.6.1.4.1.9999.0.17" || v1["source_ip"] != "127.0.0.1" {
		t.Fatalf("trap v1 = %v", v1)
	}
	if vb := v1["varbinds"].([]any)[0].(map[string]any); vb["value"] != "porta aberta" {
		t.Fatalf("varbind v1 = %v", vb)
	}

	// Desligar fecha a porta.
	srv.cfg = Config{Enabled: false, TrapPort: port}
	c.refresh(ctx)
	conn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: port})
	if err != nil {
		t.Fatalf("porta continua ocupada depois de desligar: %v", err)
	}
	conn.Close()
}

func TestTrapPortInUse(t *testing.T) {
	busy, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()
	port := busy.LocalAddr().(*net.UDPAddr).Port
	c, _ := newTestCollector(t, Config{Enabled: true, TrapPort: port})
	c.trapAddr = "127.0.0.1:" + strconv.Itoa(port)
	c.refresh(context.Background())
	if c.trap != nil {
		t.Fatal("receptor iniciou em porta ocupada")
	}
	if !strings.Contains(c.lastLogs["trap"], "indisponivel") {
		t.Fatalf("erro nao registrado: %v", c.lastLogs)
	}
	// Nova tentativa na proxima configuracao, sem repetir o log.
	c.refresh(context.Background())
	if c.trap != nil {
		t.Fatal("receptor iniciou em porta ocupada")
	}
}

func TestConvertTrapHelpers(t *testing.T) {
	if got := v1TrapOID(".1.3.6.1.4.1.9", 2, 0); got != "1.3.6.1.6.3.1.1.5.3" {
		t.Errorf("linkDown v1 = %s", got)
	}
	if got := v1TrapOID(".1.3.6.1.4.1.9", 6, 5); got != "1.3.6.1.4.1.9.0.5" {
		t.Errorf("especifico v1 = %s", got)
	}
	addr := &net.UDPAddr{IP: net.ParseIP("::ffff:10.0.0.5"), Port: 1000}
	if got := sourceIP(addr); got != "10.0.0.5" {
		t.Errorf("ip = %s", got)
	}
	if _, ok := convertTrap(&gosnmp.SnmpPacket{Version: gosnmp.Version3}, addr, time.Now()); ok {
		t.Error("trap v3 aceito")
	}
	if got := octets([]byte("texto\x00")); got != "texto" {
		t.Errorf("octets = %q", got)
	}
}
