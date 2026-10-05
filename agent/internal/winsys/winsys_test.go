package winsys

import "testing"

func TestStatusAndStartType(t *testing.T) {
	want := map[uint32]string{1: "stopped", 2: "start_pending", 3: "stop_pending", 4: "running", 7: "paused", 9: "unknown"}
	for k, v := range want {
		if got := StatusName(k); got != v {
			t.Errorf("StatusName(%d) = %q", k, got)
		}
	}
	if StartTypeName(2) != "auto" || StartTypeName(3) != "manual" || StartTypeName(4) != "disabled" {
		t.Fatal("StartTypeName")
	}
	cases := map[string]struct {
		t       uint32
		delayed bool
	}{"auto": {2, false}, "autodelay": {2, true}, "manual": {3, false}, "disabled": {4, false}}
	for in, w := range cases {
		st, d, err := ParseStartType(in)
		if err != nil || st != w.t || d != w.delayed {
			t.Errorf("ParseStartType(%q) = %d %v %v", in, st, d, err)
		}
	}
	if _, _, err := ParseStartType("boot"); err == nil {
		t.Fatal("boot nao e aceito pelo editwinsvc")
	}
}

func TestServiceMapKeys(t *testing.T) {
	m := Service{Name: "Spooler", AutoDelay: true, PID: 12}.Map()
	for _, k := range []string{"name", "display_name", "status", "start_type", "autodelay", "pid", "binpath", "username", "description"} {
		if _, ok := m[k]; !ok {
			t.Errorf("falta a chave %s", k)
		}
	}
	if m["autodelay"] != true || m["pid"] != 12 {
		t.Fatalf("valores: %+v", m)
	}
}
