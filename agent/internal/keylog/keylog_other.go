//go:build !windows

package keylog

import (
	"context"
	"log/slog"
)

func captureLoop(ctx context.Context, id string, pub publisher, log *slog.Logger) {
	_ = pub.Publish("keylog."+id, keyFrame{Keys: "[captura de teclado disponivel apenas no Windows]", Ts: 0})
	<-ctx.Done()
}
