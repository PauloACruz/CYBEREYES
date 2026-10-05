//go:build !windows

package winsys

import "context"

// ListServices so existe no Windows.
func ListServices() ([]Service, error) { return nil, ErrUnsupported }

// GetService so existe no Windows.
func GetService(string) (Service, error) { return Service{}, ErrUnsupported }

// StartService so existe no Windows.
func StartService(context.Context, string) error { return ErrUnsupported }

// StopService so existe no Windows.
func StopService(context.Context, string) error { return ErrUnsupported }

// SetStartType so existe no Windows.
func SetStartType(string, string) error { return ErrUnsupported }

// RegBrowse so existe no Windows.
func RegBrowse(string, int, int) (RegListing, error) { return RegListing{}, ErrUnsupported }

// RegCreateKey so existe no Windows.
func RegCreateKey(string) error { return ErrUnsupported }

// RegDeleteKey so existe no Windows.
func RegDeleteKey(string) error { return ErrUnsupported }

// RegRenameKey so existe no Windows.
func RegRenameKey(string, string) error { return ErrUnsupported }

// RegSetValue so existe no Windows.
func RegSetValue(string, string, string, string, bool) error { return ErrUnsupported }

// RegRenameValue so existe no Windows.
func RegRenameValue(string, string, string) error { return ErrUnsupported }

// RegDeleteValue so existe no Windows.
func RegDeleteValue(string, string) error { return ErrUnsupported }
