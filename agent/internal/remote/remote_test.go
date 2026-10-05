package remote

import (
	"context"
	"log/slog"
	"testing"
)

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

func TestConsentAskWithoutTrayIsDenied(t *testing.T) {
	control := make(chan Control, 4)
	p := HelperParams{SessionID: "s", Policy: Policy{Consent: "ask", ConsentTimeoutSeconds: 10}}
	stop := consent(context.Background(), slog.New(slog.DiscardHandler), target{User: "maria"}, p, "Joao", control)
	defer stop()
	select {
	case c := <-control:
		if c.Consent != "denied" {
			t.Fatalf("esperava denied, veio %+v", c)
		}
	default:
		t.Fatal("o resultado do pedido nao foi enviado ao remote-helper")
	}
}

func TestConsentNoneSendsNothing(t *testing.T) {
	control := make(chan Control, 4)
	stop := consent(context.Background(), slog.New(slog.DiscardHandler), target{User: "maria"}, HelperParams{Policy: Policy{Consent: "none"}}, "Joao", control)
	stop()
	if len(control) != 0 {
		t.Fatal("politica none nao deveria mandar controle")
	}
}
