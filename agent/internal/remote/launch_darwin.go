//go:build darwin

package remote

import (
	"context"
	"log/slog"
)

// findDesktop: a sessao grafica deste sistema chega na fase 12.6 (RFC-001).
func findDesktop(allowLogin bool) (target, error) { return target{}, errUnsupported }

func launchHelper(ctx context.Context, t target, p HelperParams, control <-chan Control, log *slog.Logger) error {
	return errUnsupported
}
