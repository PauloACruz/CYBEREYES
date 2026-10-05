//go:build !windows

package wua

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
	for _, f := range []string{"getwinupdates", "installwinupdates"} {
		if out := reg.Dispatch(context.Background(), rpc.Request{"func": f, "guids": []any{"x"}}); out != "error: somente Windows" {
			t.Fatalf("%s respondeu %v", f, out)
		}
	}
}
