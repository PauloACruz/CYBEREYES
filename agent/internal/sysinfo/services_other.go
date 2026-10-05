//go:build !windows

package sysinfo

import "context"

func services(context.Context) ([]Service, error) { return nil, ErrUnsupported }

func lookupService(string) (Service, error) { return Service{}, ErrUnsupported }
