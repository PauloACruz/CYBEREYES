package remote

import "testing"

func TestRelayOnAPI(t *testing.T) {
	cases := []struct{ relay, api, want string }{
		{"wss://rmm.exemplo.com/api/remote/relay/abc", "https://rmm.local", "wss://rmm.local/api/remote/relay/abc"},
		{"wss://x/api/remote/relay/abc", "http://127.0.0.1:5080/", "ws://127.0.0.1:5080/api/remote/relay/abc"},
	}
	for _, c := range cases {
		if got, ok := relayOnAPI(c.relay, c.api); !ok || got != c.want {
			t.Fatalf("%s sobre %s: %q %v", c.relay, c.api, got, ok)
		}
	}
	for _, bad := range []string{"wss://x/outra/coisa", "wss://x/api/remote/relay/../../api/agents", ":"} {
		if _, ok := relayOnAPI(bad, "https://rmm.local"); ok {
			t.Fatalf("aceitou %q", bad)
		}
	}
}

func TestParsePolicyDefaults(t *testing.T) {
	p, err := ParsePolicy(`{"consent":"notify","clipboardToLocal":false}`)
	if err != nil || p.Consent != "notify" || p.ClipboardToLocal || !p.ClipboardToRemote || p.MaxHours != 8 {
		t.Fatalf("%+v %v", p, err)
	}
}
