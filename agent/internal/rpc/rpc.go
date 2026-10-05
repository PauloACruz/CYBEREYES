// Package rpc despacha os comandos que o servidor envia ao agente pelo NATS
// (mapa msgpack com a chave "func" e os campos do comando).
package rpc

import (
	"context"
	"fmt"
	"log/slog"
	"runtime/debug"
	"strconv"
	"sync"
	"time"
)

// Request e a mensagem recebida, ja decodificada do msgpack.
type Request map[string]any

// Func devolve o nome do comando.
func (r Request) Func() string { return r.Str("func") }

// Str le um campo de texto do nivel superior.
func (r Request) Str(key string) string { return toString(r[key]) }

// Int le um campo numerico do nivel superior.
func (r Request) Int(key string) int { return toInt(r[key]) }

// Bool le um campo booleano do nivel superior.
func (r Request) Bool(key string) bool { return toBool(r[key]) }

// Strings le uma lista de textos do nivel superior.
func (r Request) Strings(key string) []string { return toStrings(r[key]) }

// Payload devolve o mapa "payload" (vazio quando ausente).
func (r Request) Payload() Request {
	if m := toMap(r["payload"]); m != nil {
		return m
	}
	return Request{}
}

// Map devolve um submapa qualquer.
func (r Request) Map(key string) Request { return toMap(r[key]) }

// Handler executa um comando. O valor devolvido e enviado como resposta (quando ha reply).
type Handler func(ctx context.Context, req Request) any

// Registry guarda os comandos conhecidos.
type Registry struct {
	mu       sync.RWMutex
	handlers map[string]Handler
	timeouts map[string]time.Duration
	log      *slog.Logger
}

// NewRegistry cria um registro vazio.
func NewRegistry(log *slog.Logger) *Registry {
	return &Registry{handlers: map[string]Handler{}, timeouts: map[string]time.Duration{}, log: log}
}

// Handle registra um comando com tempo limite padrao de 1 hora (o proprio comando pode usar menos).
func (r *Registry) Handle(name string, h Handler) { r.HandleTimeout(name, time.Hour, h) }

// HandleTimeout registra um comando com tempo limite proprio.
func (r *Registry) HandleTimeout(name string, timeout time.Duration, h Handler) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.handlers[name] = h
	r.timeouts[name] = timeout
}

// Funcs lista os comandos registrados.
func (r *Registry) Funcs() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.handlers))
	for k := range r.handlers {
		out = append(out, k)
	}
	return out
}

// Dispatch executa o comando. Comandos desconhecidos respondem com texto de erro.
func (r *Registry) Dispatch(ctx context.Context, req Request) (reply any) {
	name := req.Func()
	r.mu.RLock()
	h, ok := r.handlers[name]
	timeout := r.timeouts[name]
	r.mu.RUnlock()
	if !ok {
		r.log.Warn("comando desconhecido", "func", name)
		return "error: comando desconhecido: " + name
	}
	defer func() {
		if p := recover(); p != nil {
			r.log.Error("falha no comando", "func", name, "panic", p, "stack", string(debug.Stack()))
			reply = fmt.Sprintf("error: falha interna no comando %s", name)
		}
	}()
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return h(ctx, req)
}

func toString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case []byte:
		return string(x)
	case bool:
		return strconv.FormatBool(x)
	case float32:
		return strconv.FormatFloat(float64(x), 'f', -1, 32)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	default:
		if n, ok := asInt64(v); ok {
			return strconv.FormatInt(n, 10)
		}
		return fmt.Sprint(v)
	}
}

func toInt(v any) int {
	if n, ok := asInt64(v); ok {
		return int(n)
	}
	switch x := v.(type) {
	case float64:
		return int(x)
	case float32:
		return int(x)
	case string:
		n, _ := strconv.Atoi(x)
		return n
	case []byte:
		n, _ := strconv.Atoi(string(x))
		return n
	}
	return 0
}

func toBool(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		b, _ := strconv.ParseBool(x)
		return b
	}
	n, ok := asInt64(v)
	return ok && n != 0
}

func toStrings(v any) []string {
	switch x := v.(type) {
	case []string:
		return x
	case []any:
		out := make([]string, 0, len(x))
		for _, i := range x {
			out = append(out, toString(i))
		}
		return out
	case nil:
		return nil
	}
	return []string{toString(v)}
}

func toMap(v any) Request {
	switch x := v.(type) {
	case map[string]any:
		return x
	case Request:
		return x
	case map[any]any:
		out := Request{}
		for k, val := range x {
			out[toString(k)] = val
		}
		return out
	}
	return nil
}

func asInt64(v any) (int64, bool) {
	switch x := v.(type) {
	case int:
		return int64(x), true
	case int8:
		return int64(x), true
	case int16:
		return int64(x), true
	case int32:
		return int64(x), true
	case int64:
		return x, true
	case uint:
		return int64(x), true
	case uint8:
		return int64(x), true
	case uint16:
		return int64(x), true
	case uint32:
		return int64(x), true
	case uint64:
		return int64(x), true
	}
	return 0, false
}
