//go:build windows

package logs

import "log/slog"

func newSource(*slog.Logger) Source { return &eventLogSource{api: winevtAPI{}} }
