//go:build darwin

package logs

import "log/slog"

func newSource(*slog.Logger) Source { return &unifiedSource{} }
