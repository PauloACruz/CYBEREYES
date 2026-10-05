// Package actions tem os comandos interativos do console: comando avulso (rawcmd), script
// (runscriptfull), processos, servicos do Windows, Log de Eventos, registro e energia
// (reiniciar e desligar). Formatos de pedido e resposta seguem a secao 4.3 do contrato.
package actions

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
)

// Prazos dos comandos. Os timeouts do servidor ficam na secao 4.2 do contrato; aqui
// respondemos um pouco antes para a resposta nao chegar depois do 504.
const (
	shortTimeout   = 13 * time.Second // servidor: 15 s
	svcActionLimit = 50 * time.Second // servidor: 60 s por passo
	eventlogLimit  = 85 * time.Second // servidor: 92 s
)

type handlers struct {
	e *env.Env
}

// Register registra os comandos do modulo.
func Register(e *env.Env) error {
	h := &handlers{e: e}

	e.Reg.HandleTimeout("rawcmd", 3700*time.Second, h.rawcmd)
	e.Reg.HandleTimeout("runscriptfull", 24*time.Hour+15*time.Minute, h.runscript)

	e.Reg.HandleTimeout("procs", 20*time.Second, h.procs)
	e.Reg.HandleTimeout("killproc", 20*time.Second, h.killproc)

	e.Reg.HandleTimeout("winservices", 20*time.Second, h.winservices)
	e.Reg.HandleTimeout("winsvcdetail", 20*time.Second, h.winsvcdetail)
	e.Reg.HandleTimeout("winsvcaction", svcActionLimit+5*time.Second, h.winsvcaction)
	e.Reg.HandleTimeout("editwinsvc", 20*time.Second, h.editwinsvc)

	e.Reg.HandleTimeout("eventlog", eventlogLimit+5*time.Second, h.eventlog)

	e.Reg.HandleTimeout("registry_browse", 20*time.Second, h.registryBrowse)
	for name, fn := range h.registryWriters() {
		e.Reg.HandleTimeout(name, 20*time.Second, fn)
	}

	e.Reg.HandleTimeout("rebootnow", 10*time.Second, h.power(true))
	e.Reg.HandleTimeout("shutdown", 10*time.Second, h.power(false))
	return nil
}

// errGuardTimeout indica que a operacao nao terminou no prazo.
var errGuardTimeout = errors.New("tempo limite excedido")

// guard executa fn em segundo plano e desiste depois de limit (ou quando ctx acaba), devolvendo
// errGuardTimeout. Serve para chamadas do sistema que nao aceitam contexto: a resposta sai no
// prazo mesmo assim. Um panico em fn vira erro.
func guard[T any](ctx context.Context, limit time.Duration, fn func() T) (T, error) {
	type outcome struct {
		v   T
		err error
	}
	ch := make(chan outcome, 1)
	go func() {
		var o outcome
		defer func() {
			if p := recover(); p != nil {
				o.err = fmt.Errorf("falha interna: %v", p)
			}
			ch <- o
		}()
		o.v = fn()
	}()
	timer := time.NewTimer(limit)
	defer timer.Stop()
	var zero T
	select {
	case o := <-ch:
		return o.v, o.err
	case <-timer.C:
		return zero, errGuardTimeout
	case <-ctx.Done():
		return zero, errGuardTimeout
	}
}

// errText devolve o texto de erro padrao das respostas em str.
func errText(err error) string { return "error: " + err.Error() }

// errMap e o formato de erro do registro ({error}).
func errMap(msg string) map[string]any { return map[string]any{"error": msg} }
