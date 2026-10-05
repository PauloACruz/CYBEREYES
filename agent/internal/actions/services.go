package actions

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
	"github.com/pauloacruz/cybereyes/agent/internal/winsys"
)

// SvcResult e a resposta de winsvcaction e editwinsvc.
type SvcResult struct {
	Success  bool   `json:"success"`
	ErrorMsg string `json:"errormsg"`
}

func svcResult(err error) SvcResult {
	if err != nil {
		return SvcResult{Success: false, ErrorMsg: svcErrText(err)}
	}
	return SvcResult{Success: true}
}

func svcErrText(err error) string {
	if errors.Is(err, winsys.ErrServiceNotFound) {
		return "servico nao encontrado"
	}
	return err.Error()
}

// serviceName valida o nome curto recebido no payload.
func serviceName(req rpc.Request) (string, error) {
	name := strings.TrimSpace(req.Payload().Str("name"))
	if name == "" || len(name) > 256 || strings.ContainsAny(name, `\/`) {
		return "", errors.New("nome de servico invalido")
	}
	return name, nil
}

// winservices: lista de servicos (mapas com as chaves do contrato).
func (h *handlers) winservices(ctx context.Context, _ rpc.Request) any {
	list, err := guard(ctx, shortTimeout, func() svcList {
		l, err := winsys.ListServices()
		return svcList{l, err}
	})
	if err == nil {
		err = list.err
	}
	if err != nil {
		return errText(err)
	}
	if list.items == nil {
		return []winsys.Service{}
	}
	return list.items
}

type svcList struct {
	items []winsys.Service
	err   error
}

// winsvcdetail: { payload: { name } } -> mapa igual a um item de winservices, ou "error: not found".
func (h *handlers) winsvcdetail(ctx context.Context, req rpc.Request) any {
	name, err := serviceName(req)
	if err != nil {
		return errText(err)
	}
	type out struct {
		s   winsys.Service
		err error
	}
	r, err := guard(ctx, shortTimeout, func() out {
		s, err := winsys.GetService(name)
		return out{s, err}
	})
	if err == nil {
		err = r.err
	}
	if err != nil {
		if errors.Is(err, winsys.ErrServiceNotFound) {
			return "error: not found"
		}
		return errText(err)
	}
	return r.s
}

// winsvcaction: { payload: { name, action: start|stop } } -> { success, errormsg }, depois de o
// servico chegar ao estado final (ate 50 s).
func (h *handlers) winsvcaction(ctx context.Context, req rpc.Request) any {
	name, err := serviceName(req)
	if err != nil {
		return svcResult(err)
	}
	action := strings.ToLower(strings.TrimSpace(req.Payload().Str("action")))
	parent := ctx
	ctx, cancel := context.WithTimeout(ctx, svcActionLimit)
	defer cancel()
	var fn func() error
	switch action {
	case "start":
		fn = func() error { return winsys.StartService(ctx, name) }
	case "stop":
		fn = func() error { return winsys.StopService(ctx, name) }
	default:
		return svcResult(errors.New("acao invalida: " + action + " (use start ou stop)"))
	}
	// A espera respeita o ctx; o guard so cobre uma chamada do SCM que trave.
	res, err := guard(parent, svcActionLimit+2*time.Second, fn)
	if err != nil {
		return svcResult(err)
	}
	return svcResult(res)
}

// editwinsvc: { payload: { name, startType: auto|autodelay|manual|disabled } } -> { success, errormsg }.
func (h *handlers) editwinsvc(ctx context.Context, req rpc.Request) any {
	name, err := serviceName(req)
	if err != nil {
		return svcResult(err)
	}
	startType := strings.ToLower(strings.TrimSpace(req.Payload().Str("startType")))
	if _, _, err := winsys.ParseStartType(startType); err != nil {
		return svcResult(err)
	}
	res, err := guard(ctx, shortTimeout, func() error { return winsys.SetStartType(name, startType) })
	if err != nil {
		return svcResult(err)
	}
	return svcResult(res)
}
