//go:build !linux && !darwin && !windows

package logs

import "log/slog"

// newSource devolve nil: sem fonte de logs conhecida neste sistema.
func newSource(log *slog.Logger) Source {
	log.Info("coleta de logs sem suporte neste sistema")
	return nil
}
