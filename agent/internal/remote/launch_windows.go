//go:build windows

package remote

import (
	"context"
	"log/slog"
)

// findDesktop: a sessao grafica deste sistema chega na fase 12.3 (RFC-001).
func findDesktop(allowLogin bool) (target, error) { return target{}, errUnsupported }

func launchHelper(ctx context.Context, t target, p HelperParams, log *slog.Logger) error {
	return errUnsupported
}
