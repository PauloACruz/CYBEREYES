//go:build !windows

package choco

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

func TestStubsOutsideWindows(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	reg := rpc.NewRegistry(log)
	if err := Register(&env.Env{Reg: reg, Log: log, Ctx: context.Background()}); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"installchoco", "installwithchoco"} {
		req := rpc.Request{"func": f, "choco_prog_name": "git", "pending_action_pk": 1}
		if out := reg.Dispatch(context.Background(), req); out != "error: somente Windows" {
			t.Fatalf("%s respondeu %v", f, out)
		}
	}
}
