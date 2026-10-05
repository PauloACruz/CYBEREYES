package actions

import (
	"context"
	"strconv"
	"strings"

	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
	"github.com/pauloacruz/cybereyes/agent/internal/winsys"
)

const (
	regPageSize    = 200
	regMaxPageSize = 1000
)

// regPage le page e page_size (str); invalidos viram 1 e 200.
func regPage(p rpc.Request) (page, size int) {
	page, err := strconv.Atoi(strings.TrimSpace(p.Str("page")))
	if err != nil || page < 1 {
		page = 1
	}
	size, err = strconv.Atoi(strings.TrimSpace(p.Str("page_size")))
	if err != nil || size < 1 {
		size = regPageSize
	}
	if size > regMaxPageSize {
		size = regMaxPageSize
	}
	return page, size
}

// registryBrowse: { payload: { path, page, page_size } } -> { path, subkeys, values, has_more } ou { error }.
func (h *handlers) registryBrowse(ctx context.Context, req rpc.Request) any {
	p := req.Payload()
	path := p.Str("path")
	page, size := regPage(p)
	type out struct {
		l   winsys.RegListing
		err error
	}
	r, err := guard(ctx, shortTimeout, func() out {
		l, err := winsys.RegBrowse(path, page, size)
		return out{l, err}
	})
	if err == nil {
		err = r.err
	}
	if err != nil {
		return errMap(err.Error())
	}
	if r.l.Subkeys == nil {
		r.l.Subkeys = []winsys.RegSubkey{}
	}
	if r.l.Values == nil {
		r.l.Values = []winsys.RegValue{}
	}
	return r.l
}

// regWrite executa uma escrita no registro: sucesso responde "ok"; erro so como mapa { error }
// (o servidor trata qualquer outra resposta como sucesso).
func regWrite(ctx context.Context, fn func() error) any {
	res, err := guard(ctx, shortTimeout, fn)
	if err == nil {
		err = res
	}
	if err != nil {
		return errMap(err.Error())
	}
	return "ok"
}

// registryWriters devolve os 7 comandos de escrita no registro.
func (h *handlers) registryWriters() map[string]rpc.Handler {
	return map[string]rpc.Handler{
		"registry_create_key": func(ctx context.Context, req rpc.Request) any {
			p := req.Payload()
			return regWrite(ctx, func() error { return winsys.RegCreateKey(p.Str("path")) })
		},
		"registry_delete_key": func(ctx context.Context, req rpc.Request) any {
			p := req.Payload()
			return regWrite(ctx, func() error { return winsys.RegDeleteKey(p.Str("path")) })
		},
		"registry_rename_key": func(ctx context.Context, req rpc.Request) any {
			p := req.Payload()
			return regWrite(ctx, func() error { return winsys.RegRenameKey(p.Str("old_path"), p.Str("new_path")) })
		},
		"registry_create_value": func(ctx context.Context, req rpc.Request) any {
			p := req.Payload()
			return regWrite(ctx, func() error {
				return winsys.RegSetValue(p.Str("path"), p.Str("name"), p.Str("type"), p.Str("data"), true)
			})
		},
		"registry_modify_value": func(ctx context.Context, req rpc.Request) any {
			p := req.Payload()
			return regWrite(ctx, func() error {
				return winsys.RegSetValue(p.Str("path"), p.Str("name"), p.Str("type"), p.Str("data"), false)
			})
		},
		"registry_rename_value": func(ctx context.Context, req rpc.Request) any {
			p := req.Payload()
			return regWrite(ctx, func() error {
				return winsys.RegRenameValue(p.Str("path"), p.Str("old_name"), p.Str("new_name"))
			})
		},
		"registry_delete_value": func(ctx context.Context, req rpc.Request) any {
			p := req.Payload()
			return regWrite(ctx, func() error { return winsys.RegDeleteValue(p.Str("path"), p.Str("name")) })
		},
	}
}
