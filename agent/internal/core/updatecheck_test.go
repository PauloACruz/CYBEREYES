package core

import (
	"context"
	"testing"

	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

func TestUpdateRejectsConcurrentRun(t *testing.T) {
	updating.Lock()
	defer updating.Unlock()
	// Com outra atualizacao em andamento, responde antes de tocar no binario (por isso o env pode ser nulo).
	got := update(context.Background(), nil, rpc.Request{"payload": map[string]any{"version": "99.0.0"}})
	if got != "error: ja existe uma atualizacao em andamento" {
		t.Fatalf("update concorrente = %v", got)
	}
}

func TestNewer(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"3.0.1", "3.0.0", true},
		{"3.1.0", "3.0.9", true},
		{"3.0.0", "3.0.0", false},
		{"2.13.0", "3.0.0", false},
		{"10.0.0", "9.9.9", true},
	}
	for _, c := range cases {
		if got := newer(c.a, c.b); got != c.want {
			t.Errorf("newer(%s, %s) = %v", c.a, c.b, got)
		}
	}
}
