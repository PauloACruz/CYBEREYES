//go:build !windows

package checks

import "errors"

// errUnsupported indica check exclusivo do Windows (o servidor nao os envia a outros sistemas).
var errUnsupported = errors.New("disponivel somente no Windows")

func queryService(string) (string, error) { return "", errUnsupported }

func startService(string) error { return errUnsupported }
