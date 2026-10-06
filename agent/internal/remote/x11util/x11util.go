// Package x11util reune ajustes comuns as conexoes X11 do acesso remoto.
package x11util

import (
	"io"
	"log"

	"github.com/jezek/xgb"
)

func init() {
	// O xgb registra avisos (por exemplo, falta de .Xauthority) no stderr; o EYES tem o proprio log.
	xgb.Logger = log.New(io.Discard, "", 0)
}
