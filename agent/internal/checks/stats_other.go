//go:build !linux && !windows && !darwin

package checks

import (
	"context"
	"errors"
)

var errStatsUnsupported = errors.New("uso de CPU e memoria nao suportado neste sistema")

type noSource struct{}

func (noSource) next(context.Context) (float64, error) { return 0, errStatsUnsupported }

func newCPUSource() cpuSource { return noSource{} }

func readMemPercent() (float64, error) { return 0, errStatsUnsupported }
