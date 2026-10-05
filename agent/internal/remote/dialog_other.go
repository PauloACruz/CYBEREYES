//go:build !linux && !darwin

package remote

import (
	"context"
	"time"
)

// No Windows o aviso e o pedido ficam com o eyes-tray.
func systemAsk(context.Context, target, string, time.Duration) (bool, error) {
	return false, errNoDialog
}

func systemNotify(context.Context, target, string) error { return errNoDialog }
