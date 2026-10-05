package checks

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// Tipos de check enviados pelo servidor (contrato 3.5).
const (
	typeDiskSpace = "diskspace"
	typeCPULoad   = "cpuload"
	typeMemory    = "memory"
	typePing      = "ping"
	typeScript    = "script"
	typeWinSvc    = "winsvc"
	typeEventLog  = "eventlog"
)

// Valores de status de ping e winsvc avaliados pelo servidor ("failing" falha, o resto passa).
const (
	statusPassing = "passing"
	statusFailing = "failing"
)

// defaultTimeout e o tempo limite quando o check nao informa (padrao do servidor).
const defaultTimeout = 60 * time.Second

// Check e um check recebido de GET checkrunner/runchecks, ja lido de forma tolerante.
type Check struct {
	ID          int
	Type        string
	RunInterval int // segundos; 0 = intervalo do agente
	Disk        string
	IP          string
	Script      *ScriptInfo
	ScriptArgs  []string
	EnvVars     []string
	Timeout     time.Duration

	SvcName            string
	PassIfStartPending bool
	PassIfSvcNotExist  bool
	RestartIfStopped   bool

	LogName         string
	EventID         int
	EventIDWildcard bool
	EventType       string
	EventSource     string
	EventMessage    string
	SearchLastDays  int
}

// ScriptInfo e o mapa "script" do check do tipo script.
type ScriptInfo struct {
	Code      string
	Shell     string
	RunAsUser bool
	EnvVars   []string
}

// parseCheck converte o mapa JSON em Check. Campos com tipo errado viram zero; so id e tipo sao obrigatorios.
func parseCheck(raw map[string]any) (c Check, err error) {
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("check malformado: %v", p)
		}
	}()
	if raw == nil {
		return c, errors.New("check vazio")
	}
	r := rpc.Request(raw)
	c.ID = r.Int("id")
	c.Type = strings.ToLower(strings.TrimSpace(str(r, "check_type")))
	if c.ID <= 0 {
		return c, errors.New("check sem id valido")
	}
	if c.Type == "" {
		return c, fmt.Errorf("check %d sem check_type", c.ID)
	}
	c.RunInterval = max(r.Int("run_interval"), 0)
	c.Disk = strings.TrimSpace(str(r, "disk"))
	c.IP = strings.TrimSpace(str(r, "ip"))
	c.ScriptArgs = strs(r, "script_args")
	c.EnvVars = strs(r, "env_vars")
	c.Timeout = time.Duration(r.Int("timeout")) * time.Second
	if c.Timeout <= 0 {
		c.Timeout = defaultTimeout
	}
	if m := r.Map("script"); m != nil {
		c.Script = &ScriptInfo{
			Code:      str(m, "code"),
			Shell:     strings.ToLower(strings.TrimSpace(str(m, "shell"))),
			RunAsUser: m.Bool("run_as_user"),
			EnvVars:   strs(m, "env_vars"),
		}
	}
	c.SvcName = strings.TrimSpace(str(r, "svc_name"))
	c.PassIfStartPending = r.Bool("pass_if_start_pending")
	c.PassIfSvcNotExist = r.Bool("pass_if_svc_not_exist")
	c.RestartIfStopped = r.Bool("restart_if_stopped")
	c.LogName = strings.TrimSpace(str(r, "log_name"))
	c.EventID = r.Int("event_id")
	c.EventIDWildcard = r.Bool("event_id_is_wildcard")
	c.EventType = strings.TrimSpace(str(r, "event_type"))
	c.EventSource = strings.TrimSpace(str(r, "event_source"))
	c.EventMessage = strings.TrimSpace(str(r, "event_message"))
	c.SearchLastDays = r.Int("search_last_days")
	return c, nil
}

// str le um texto ignorando valores que nao sao texto (nil, mapas, listas).
func str(r rpc.Request, key string) string {
	switch v := r[key].(type) {
	case string:
		return v
	case nil, map[string]any, []any:
		return ""
	}
	return r.Str(key)
}

// strs le uma lista de textos, descartando itens vazios ou nulos.
func strs(r rpc.Request, key string) []string {
	switch r[key].(type) {
	case []any, []string:
	default:
		return nil
	}
	var out []string
	for _, s := range r.Strings(key) {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}
