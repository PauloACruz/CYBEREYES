package files

import "errors"

// User e o usuario da sessao grafica acessada (Name no formato do sistema; Session so no Windows).
type User struct {
	Name    string
	Session uint32
}

// Home e o resultado da operacao home (contrato, secao 7.2).
type Home struct {
	Desktop   string `json:"desktop"`
	Home      string `json:"home"`
	Downloads string `json:"downloads"`
	Separator string `json:"separator"`
}

// ErrNoUser indica que nao ha usuario conectado para resolver as pastas.
var ErrNoUser = errors.New("sem usuario conectado")
