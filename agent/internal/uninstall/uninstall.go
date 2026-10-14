// Package uninstall faz a desinstalacao avancada de programas no Windows, nos moldes do Revo
// Uninstaller: roda o desinstalador do proprio programa sem janela (softwareuninstall), procura
// as sobras no registro, nas pastas, atalhos, inicializacao, servicos e tarefas, e remove as que
// o tecnico escolher no console (softwarecleanup), com copia das chaves antes de apagar.
// Contrato: docs/agente/contrato-eyes.md, secao 4.3.
package uninstall

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
	"github.com/pauloacruz/cybereyes/agent/internal/service"
)

// Tempos e limites.
const (
	uninstallTimeout   = 30 * time.Minute
	restorePointLimit  = 5 * time.Minute
	reportTimeout      = 2 * time.Minute
	settleDelay        = 3 * time.Second
	maxCleanupItems    = maxLeftovers
	maxLog             = 64 << 10
	maxRequestNameSize = 500
)

// ownService e o servico do proprio agente (nunca removido).
const ownService = service.Name

// runResult e o resultado do desinstalador.
type runResult struct {
	ExitCode int
	TimedOut bool
	Err      error
	Elapsed  time.Duration
}

// system e a ponte com o Windows (de verdade ou falso nos testes).
type system interface {
	host
	// Find le a entrada de desinstalacao pela chave ou, sem chave, pelo nome (e versao, se houver).
	Find(key, name, version string) (Entry, bool)
	SystemRoot() string
	RestorePoint(ctx context.Context, description string) (string, error)
	// Run executa o desinstalador e espera ele e todos os processos que ele abrir.
	Run(ctx context.Context, cmdLine string, timeout time.Duration) runResult
	// Remove apaga o item; reboot indica remocao agendada para o proximo reinicio.
	Remove(ctx context.Context, it Leftover, backupDir string) (reboot bool, err error)
	// BackupDir devolve (sem criar) a pasta da copia de seguranca desta limpeza.
	BackupDir(name string) string
}

// rest e o subconjunto do cliente REST usado aqui (*api.Client o satisfaz).
type rest interface {
	Patch(ctx context.Context, path string, body, out any) error
}

type worker struct {
	sys     system
	api     rest
	agentID string
	log     *slog.Logger
	spawn   func(name string, fn func(ctx context.Context))
	sleep   func(ctx context.Context, d time.Duration)
	// mu deixa uma desinstalacao ou limpeza por vez (desinstaladores falham em paralelo).
	mu sync.Mutex
}

func newService(e *env.Env, sys system) *worker {
	return &worker{
		sys:     sys,
		api:     e.API,
		agentID: e.Cfg.AgentID,
		log:     e.Log.With("modulo", "desinstalacao"),
		spawn:   e.Go,
		sleep:   sleepCtx,
	}
}

// uninstallRequest e o pedido softwareuninstall.
type uninstallRequest struct {
	PK             int
	Name           string
	Version        string
	Publisher      string
	Location       string
	Key            string
	Mode           Mode
	RunUninstaller bool
	RestorePoint   bool
}

func parseUninstall(req rpc.Request) uninstallRequest {
	return uninstallRequest{
		PK:             req.Int("pending_action_pk"),
		Name:           strings.TrimSpace(req.Str("name")),
		Version:        strings.TrimSpace(req.Str("version")),
		Publisher:      strings.TrimSpace(req.Str("publisher")),
		Location:       strings.TrimSpace(req.Str("location")),
		Key:            strings.TrimSpace(req.Str("key")),
		Mode:           ParseMode(req.Str("mode")),
		RunUninstaller: req.Bool("run_uninstaller"),
		RestorePoint:   req.Bool("restore_point"),
	}
}

// parseItems le a lista de itens do softwarecleanup.
func parseItems(req rpc.Request) []Leftover {
	raw, _ := req["items"].([]any)
	out := make([]Leftover, 0, len(raw))
	for _, v := range raw {
		m := rpc.Request{"i": v}.Map("i")
		if m == nil {
			continue
		}
		out = append(out, Leftover{Kind: m.Str("kind"), Path: strings.TrimSpace(m.Str("path")), Name: m.Str("name")})
	}
	return out
}

// register liga os comandos. Ambos chegam por publish; o trabalho segue em segundo plano e o
// resultado vai por PATCH /api/v4/{agent_id}/{pk}/softwareresult/.
func (s *worker) register(reg *rpc.Registry) {
	reg.HandleTimeout("softwareuninstall", 10*time.Second, func(_ context.Context, req rpc.Request) any {
		r := parseUninstall(req)
		if r.PK <= 0 {
			s.log.Warn("softwareuninstall sem pending_action_pk valido", "programa", r.Name)
			return "error: pending_action_pk invalido"
		}
		s.spawn("desinstalacao", func(ctx context.Context) { s.uninstall(ctx, r) })
		return "ok"
	})
	reg.HandleTimeout("softwarecleanup", 10*time.Second, func(_ context.Context, req rpc.Request) any {
		pk := req.Int("pending_action_pk")
		if pk <= 0 {
			s.log.Warn("softwarecleanup sem pending_action_pk valido")
			return "error: pending_action_pk invalido"
		}
		name, items := strings.TrimSpace(req.Str("name")), parseItems(req)
		s.spawn("limpeza-de-sobras", func(ctx context.Context) { s.cleanup(ctx, pk, name, items) })
		return "ok"
	})
}

// report e o corpo do PATCH softwareresult.
type report struct {
	OK      bool   `json:"ok"`
	Results string `json:"results"`
	// Desinstalacao.
	Leftovers      []Leftover `json:"leftovers,omitempty"`
	Scanned        bool       `json:"scanned,omitempty"`
	RanUninstaller bool       `json:"ran_uninstaller,omitempty"`
	StillInstalled bool       `json:"still_installed,omitempty"`
	// Limpeza.
	Removed int    `json:"removed,omitempty"`
	Failed  int    `json:"failed,omitempty"`
	Backup  string `json:"backup,omitempty"`
	// Ambos: reinicio necessario para concluir.
	Reboot bool `json:"reboot,omitempty"`
}

// journal e o texto mostrado no console, uma linha por passo.
type journal struct{ b strings.Builder }

func (j *journal) add(format string, args ...any) {
	if j.b.Len() > 0 {
		j.b.WriteByte('\n')
	}
	fmt.Fprintf(&j.b, format, args...)
}

func (j *journal) String() string {
	s := j.b.String()
	if len(s) > maxLog {
		return s[:maxLog] + "\n[registro cortado]"
	}
	return s
}

// uninstall executa o fluxo completo e envia o resultado.
func (s *worker) uninstall(ctx context.Context, r uninstallRequest) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var j journal
	rep := report{OK: true}
	defer func() {
		rep.Results = j.String()
		s.send(ctx, r.PK, rep)
	}()
	if r.Name == "" || len(r.Name) > maxRequestNameSize {
		rep.OK = false
		j.add("Pedido sem nome de programa valido.")
		return
	}
	sysRoot := s.sys.SystemRoot()
	entry, found := s.sys.Find(r.Key, r.Name, r.Version)
	if !found && r.Key != "" {
		// A chave pode ter mudado (atualizacao do programa): procura pelo nome.
		if other, ok := s.sys.Find("", r.Name, ""); ok {
			if r.Version == "" || strings.EqualFold(other.Version, r.Version) {
				entry, found = other, true
			} else {
				rep.OK = false
				j.add("%s esta instalado em outra versao (%s, o console pediu %s). Atualize o inventario e tente de novo.", r.Name, other.Version, r.Version)
				return
			}
		}
	}
	target := Target{Name: r.Name, Version: r.Version, Publisher: r.Publisher, Key: r.Key}
	if found {
		target = entry.target(sysRoot)
		j.add("Programa: %s %s (%s)", entry.Name, entry.Version, orDash(entry.Publisher))
		j.add("Entrada de desinstalacao: %s", entry.Key)
	} else {
		if c := cleanWin(r.Location); c != "" {
			target.Dirs = []string{c}
		}
		j.add("Programa: %s %s (%s)", r.Name, r.Version, orDash(r.Publisher))
		j.add("O programa nao esta mais registrado no Windows; so as sobras serao procuradas.")
	}

	if r.RestorePoint {
		out, err := s.sys.RestorePoint(ctx, "Cybereyes: antes de desinstalar "+clip(target.Name, 150))
		if err != nil {
			j.add("Ponto de restauracao nao criado: %v", err)
		} else {
			j.add("Ponto de restauracao solicitado.")
		}
		if out = strings.TrimSpace(out); out != "" {
			j.add("%s", clip(out, 1000))
		}
	}

	scan := true
	switch {
	case !found:
	case !r.RunUninstaller:
		j.add("Remocao forcada: o desinstalador do programa nao foi executado.")
		rep.StillInstalled = true
	default:
		p, err := planUninstall(entry, sysRoot)
		if err != nil {
			rep.OK = false
			j.add("Desinstalador nao executado: %v.", err)
			if entry.UninstallString != "" {
				j.add("Linha registrada: %s", entry.UninstallString)
			}
			j.add("Use a remocao forcada (sem o desinstalador) ou desinstale pelo acesso remoto e depois procure as sobras.")
			return
		}
		j.add("Executando o desinstalador (%s): %s", p.Kind, p.CmdLine)
		s.log.Info("executando desinstalador", "programa", entry.Name, "tipo", p.Kind)
		rep.RanUninstaller = true
		res := s.sys.Run(ctx, p.CmdLine, uninstallTimeout)
		ok := res.Err == nil && !res.TimedOut && exitOK(res.ExitCode)
		switch {
		case res.Err != nil:
			j.add("Falha ao iniciar o desinstalador: %v", res.Err)
		case res.TimedOut:
			j.add("O desinstalador (ou algo aberto por ele) nao terminou no prazo e foi encerrado.")
		case rebootExit[res.ExitCode]:
			rep.Reboot = true
			j.add("Desinstalador concluido em %s; reinicio necessario (%s).", res.Elapsed.Round(time.Second), exitText(res.ExitCode))
		case ok:
			j.add("Desinstalador concluido em %s (%s).", res.Elapsed.Round(time.Second), exitText(res.ExitCode))
		default:
			j.add("O desinstalador terminou com erro (%s).", exitText(res.ExitCode))
		}
		s.sleep(ctx, settleDelay)
		_, still := s.sys.Find(entry.Key, "", "")
		rep.StillInstalled = still
		s.log.Info("desinstalador terminou", "programa", entry.Name, "codigo", res.ExitCode, "registrado", still)
		if res.TimedOut && res.Err == nil && !still {
			// Um processo aberto pelo desinstalador (navegador, pesquisa) ficou para tras, mas o programa saiu.
			ok = true
			j.add("O programa saiu do registro do Windows; o que ficou aberto foi encerrado.")
		}
		if !ok {
			rep.OK = false
		}
		switch {
		case !ok && still:
			scan = false
			j.add("O programa continua instalado; as sobras nao foram procuradas.")
		case still:
			j.add("Atencao: o desinstalador terminou, mas o programa continua registrado no Windows. Revise as sobras com cuidado.")
		}
	}
	if !scan || ctx.Err() != nil {
		return
	}
	j.add("Procurando sobras (modo %s)...", modeLabel(r.Mode))
	rep.Leftovers = Scan(s.sys, target, r.Mode)
	rep.Scanned = true
	if len(rep.Leftovers) == 0 {
		j.add("Nenhuma sobra encontrada.")
	} else {
		j.add("%d sobra(s) encontrada(s). Revise e escolha o que remover.", len(rep.Leftovers))
	}
}

// removeOrder: servicos e tarefas param antes de apagar as pastas onde estao.
var removeOrder = map[string]int{KindService: 0, KindTask: 1, KindValue: 2, KindKey: 3, KindFile: 4, KindDir: 5}

// cleanup confere e remove os itens escolhidos no console.
func (s *worker) cleanup(ctx context.Context, pk int, name string, items []Leftover) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var j journal
	rep := report{OK: true}
	defer func() {
		rep.Results = j.String()
		s.send(ctx, pk, rep)
	}()
	if len(items) == 0 {
		rep.OK = false
		j.add("Nenhum item para remover.")
		return
	}
	if len(items) > maxCleanupItems {
		rep.OK = false
		j.add("Itens demais (%d; limite %d).", len(items), maxCleanupItems)
		return
	}
	sort.SliceStable(items, func(a, b int) bool { return removeOrder[items[a].Kind] < removeOrder[items[b].Kind] })
	layout := s.sys.Layout()
	backup := s.sys.BackupDir(name)
	for _, it := range items {
		if ctx.Err() != nil {
			j.add("Limpeza interrompida (o agente esta parando).")
			rep.OK = false
			break
		}
		label := describe(it)
		if err := layout.check(it); err != nil {
			rep.Failed++
			j.add("Recusado: %s (%v)", label, err)
			continue
		}
		reboot, err := s.sys.Remove(ctx, it, backup)
		switch {
		case err != nil:
			rep.Failed++
			j.add("Falhou: %s (%v)", label, err)
		case reboot:
			rep.Removed++
			rep.Reboot = true
			j.add("Agendado para o proximo reinicio: %s", label)
		default:
			rep.Removed++
			j.add("Removido: %s", label)
		}
	}
	if rep.Failed > 0 {
		rep.OK = false
	}
	if hasRegistry(items) {
		rep.Backup = backup
		j.add("Copia das chaves e servicos removidos: %s", backup)
	}
	j.add("%d removido(s), %d com falha.", rep.Removed, rep.Failed)
	s.log.Info("limpeza de sobras concluida", "programa", name, "removidos", rep.Removed, "falhas", rep.Failed)
}

func hasRegistry(items []Leftover) bool {
	for _, it := range items {
		switch it.Kind {
		case KindKey, KindValue, KindService, KindTask:
			return true
		}
	}
	return false
}

func describe(it Leftover) string {
	switch it.Kind {
	case KindKey:
		return "chave " + it.Path
	case KindValue:
		return fmt.Sprintf("valor %q em %s", it.Name, it.Path)
	case KindDir:
		return "pasta " + it.Path
	case KindFile:
		return "arquivo " + it.Path
	case KindService:
		return "servico " + it.Path
	case KindTask:
		return "tarefa " + it.Path
	}
	return it.Kind + " " + it.Path
}

func modeLabel(m Mode) string {
	switch m {
	case Safe:
		return "seguro"
	case Advanced:
		return "avancado"
	}
	return "moderado"
}

func orDash(s string) string {
	if s == "" {
		return "fabricante nao informado"
	}
	return s
}

func (s *worker) send(parent context.Context, pk int, rep report) {
	// Mesmo com o agente parando, tenta entregar o resultado.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), reportTimeout)
	defer cancel()
	if err := s.api.Patch(ctx, resultPath(s.agentID, pk), rep, nil); err != nil {
		s.log.Warn("falha ao enviar o resultado da desinstalacao", "pk", pk, "erro", err)
	}
}

// resultPath segue a ordem do chocoresult: agent_id antes do pk.
func resultPath(agentID string, pk int) string {
	return fmt.Sprintf("/api/v4/%s/%d/softwareresult/", url.PathEscape(agentID), pk)
}

func sleepCtx(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}
