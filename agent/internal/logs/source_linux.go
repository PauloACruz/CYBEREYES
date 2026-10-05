//go:build linux

package logs

import "log/slog"

func newSource(*slog.Logger) Source { return &journalSource{} }
