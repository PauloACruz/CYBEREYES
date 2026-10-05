//go:build windows

package input

import "errors"

// Open: a entrada deste sistema chega na fase 12.3 (RFC-001).
func Open() (Injector, error) {
	return nil, errors.New("entrada remota ainda nao disponivel neste sistema")
}
