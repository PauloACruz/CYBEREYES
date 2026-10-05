//go:build !windows

package winevt

import "time"

func query(string, time.Time, int) ([]Event, error)   { return nil, ErrUnsupported }
func queryAfter(string, uint64, int) ([]Event, error) { return nil, ErrUnsupported }
func lastRecord(string) (uint64, error)               { return 0, ErrUnsupported }
