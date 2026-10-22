//go:build !windows && !linux && !darwin

package speedtest

import "context"

func platformNetwork(context.Context, *Network) []string { return nil }
