// Package wua integra o EYES ao Windows Update (Windows Update Agent, via COM): varredura de
// atualizacoes pendentes (getwinupdates) e instalacao das aprovadas no console (installwinupdates).
// Contrato: docs/agente/contrato-eyes.md, secoes 3.7 e 4.3.
package wua

import (
	"context"
	"errors"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// Rotas do servidor (secao 3.7).
const (
	pathWinUpdates = "/api/v3/winupdates/"
	pathSuperseded = "/api/v3/superseded/"
)

// Limites e tempos.
const (
	// maxItems limita o lote de wua_updates (as instaladas sao cortadas primeiro).
	maxItems = 1000
	// maxGUIDs limita a lista recebida em installwinupdates.
	maxGUIDs = 500
	// scanTimeout e o tempo maximo de uma varredura (a busca online pode demorar varios minutos).
	scanTimeout = time.Hour
	// installTimeout e o tempo maximo de uma rodada de instalacao.
	installTimeout = 6 * time.Hour
	// reportTimeout limita cada chamada REST de resultado.
	reportTimeout = 2 * time.Minute
)

// ErrUnsupported e devolvido fora do Windows.
var ErrUnsupported = errors.New("somente Windows")

// Update e um item de wua_updates, com as chaves exatas que o servidor le (secao 3.7).
type Update struct {
	GUID string `json:"guid"`
	// KBArticleIDs leva so os digitos ("5001"); o servidor exibe "KB" + primeiro.
	KBArticleIDs   []string `json:"kb_article_ids"`
	Title          string   `json:"title"`
	Description    string   `json:"description"`
	Severity       string   `json:"severity"`
	Categories     []string `json:"categories"`
	MoreInfoURLs   []string `json:"more_info_urls"`
	SupportURL     string   `json:"support_url"`
	RevisionNumber int      `json:"revision_number"`
	Installed      bool     `json:"installed"`
	Downloaded     bool     `json:"downloaded"`
	// Supersedes lista as atualizacoes que esta substitui (uso interno, nao vai ao servidor).
	Supersedes []string `json:"-"`
}

// InstallResult e o resultado da instalacao de uma atualizacao.
type InstallResult struct {
	GUID           string
	Success        bool
	RebootRequired bool
	// Detail explica falhas (codigo HRESULT, atualizacao nao encontrada...); so vai ao log.
	Detail string
}

// backend e a ponte com o Windows Update Agent (COM no Windows, stub nos demais sistemas).
type backend interface {
	// Scan devolve as atualizacoes pendentes (nao instaladas e nao ocultas) e as instaladas.
	// Falha na lista de instaladas nao deve impedir a devolucao das pendentes.
	Scan(ctx context.Context) (pending, installed []Update, err error)
	// Install baixa e instala as atualizacoes indicadas, chamando report uma vez por GUID pedido.
	// Devolve se o sistema precisa reiniciar ao final.
	Install(ctx context.Context, guids []string, report func(InstallResult)) (rebootRequired bool, err error)
}

// rest e o subconjunto do cliente REST usado aqui (*api.Client o satisfaz).
type rest interface {
	Post(ctx context.Context, path string, body, out any) error
	Put(ctx context.Context, path string, body, out any) error
	Patch(ctx context.Context, path string, body, out any) error
}

// service guarda o estado do modulo: as operacoes no WUA rodam uma de cada vez.
type service struct {
	be      backend
	api     rest
	agentID string
	log     *slog.Logger
	// spawn executa em segundo plano (env.Env.Go em producao; direto nos testes).
	spawn func(name string, fn func(ctx context.Context))
	// refresh pede o reenvio do inventario (needs_reboot no agent-agentinfo).
	refresh func()

	// mu serializa varreduras e instalacoes.
	mu sync.Mutex
	// scanQueued junta pedidos de varredura que chegam enquanto outra ainda nao comecou.
	scanQueued atomic.Bool

	stateMu sync.Mutex
	// installedHere guarda as atualizacoes instaladas com sucesso por este processo. Enquanto a
	// maquina nao reinicia, o WUA pode continuar listando-as como pendentes; sem esta marca a
	// varredura seguinte desfaria o PATCH {success:true} e o agendador tentaria instalar de novo.
	installedHere map[string]bool
	// lastPending sao os GUIDs pendentes enviados na ultima varredura.
	lastPending map[string]bool
}

func newService(e *env.Env, be backend) *service {
	s := &service{
		be:            be,
		api:           e.API,
		agentID:       e.Cfg.AgentID,
		log:           e.Log.With("modulo", "wua"),
		spawn:         e.Go,
		refresh:       e.Refresh,
		installedHere: map[string]bool{},
		lastPending:   map[string]bool{},
	}
	return s
}

// register liga os comandos ao registro. Ambos chegam por publish: a resposta e descartada,
// e o trabalho continua em segundo plano para nao depender do tempo limite do despacho.
func (s *service) register(reg *rpc.Registry) {
	reg.HandleTimeout("getwinupdates", 10*time.Second, func(context.Context, rpc.Request) any {
		s.requestScan()
		return "ok"
	})
	reg.HandleTimeout("installwinupdates", 10*time.Second, func(_ context.Context, req rpc.Request) any {
		guids := sanitizeGUIDs(req.Strings("guids"))
		if len(guids) == 0 {
			return "error: nenhuma atualizacao informada"
		}
		s.spawn("wua-install", func(ctx context.Context) { s.installAndReport(ctx, guids) })
		return "ok"
	})
}

// requestScan agenda uma varredura; pedidos repetidos antes do inicio dela sao descartados.
func (s *service) requestScan() {
	if !s.scanQueued.CompareAndSwap(false, true) {
		return
	}
	s.spawn("wua-scan", func(ctx context.Context) {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.scanQueued.Store(false)
		ctx, cancel := context.WithTimeout(ctx, scanTimeout)
		defer cancel()
		if err := s.scan(ctx); err != nil {
			s.log.Warn("varredura do Windows Update falhou", "erro", err)
		}
	})
}

// scan varre o WUA e envia POST /api/v3/winupdates/ e POST /api/v3/superseded/.
// Chamado com s.mu travado.
func (s *service) scan(ctx context.Context) error {
	start := time.Now()
	pending, installed, err := s.be.Scan(ctx)
	if err != nil {
		return err
	}
	s.stateMu.Lock()
	items, superseded := buildPayload(pending, installed, s.installedHere, s.lastPending)
	s.stateMu.Unlock()

	body := map[string]any{"agent_id": s.agentID, "wua_updates": items}
	err = s.api.Post(ctx, pathWinUpdates, body, nil)
	switch {
	case err == nil:
	case len(items) == 0 && api.IsStatus(err, 400):
		// Servidores antigos recusam a lista vazia com 400 "Empty payload" (secao 9, item 2):
		// nao ha o que limpar por aqui, a proxima varredura com itens corrige a lista.
		s.log.Info("servidor recusou a lista vazia de atualizacoes; nada a enviar", "erro", err)
	default:
		return err
	}

	next := map[string]bool{}
	for _, u := range items {
		if !u.Installed {
			next[u.GUID] = true
		}
	}
	s.stateMu.Lock()
	s.lastPending = next
	s.stateMu.Unlock()

	for _, g := range superseded {
		if err := s.api.Post(ctx, pathSuperseded, map[string]any{"agent_id": s.agentID, "guid": g}, nil); err != nil {
			s.log.Warn("falha ao informar atualizacao substituida", "guid", g, "erro", err)
		}
	}
	s.log.Info("varredura do Windows Update concluida", "pendentes", len(next), "itens", len(items),
		"substituidas", len(superseded), "duracao", time.Since(start).Round(time.Second))
	return nil
}

// installAndReport instala as atualizacoes pedidas, envia um PATCH por GUID e, no fim,
// PUT {needs_reboot}. O reinicio fica com o servidor, que publica rebootnow conforme a
// politica de patch; o EYES nunca reinicia por conta propria aqui (evita reinicio duplo).
func (s *service) installAndReport(parent context.Context, guids []string) {
	s.mu.Lock()
	ctx, cancel := context.WithTimeout(parent, installTimeout)
	start := time.Now()
	s.log.Info("instalacao de atualizacoes iniciada", "quantidade", len(guids))

	// report pode ser chamado pela thread do COM mesmo depois do tempo limite: o mapa e protegido.
	var repMu sync.Mutex
	reported := map[string]bool{}
	report := func(r InstallResult) {
		g := strings.ToLower(r.GUID)
		repMu.Lock()
		dup := g == "" || reported[g]
		reported[g] = true
		repMu.Unlock()
		if dup {
			return
		}
		if r.Success {
			s.stateMu.Lock()
			s.installedHere[g] = true
			s.stateMu.Unlock()
			s.log.Info("atualizacao instalada", "guid", r.GUID, "reinicio", r.RebootRequired)
		} else {
			s.log.Warn("atualizacao nao instalada", "guid", r.GUID, "detalhe", r.Detail)
		}
		s.patchResult(parent, r.GUID, r.Success)
	}
	reboot, err := s.be.Install(ctx, guids, report)
	if err != nil {
		s.log.Warn("instalacao de atualizacoes interrompida", "erro", err)
	}
	// Todo GUID pedido recebe um resultado, mesmo quando o WUA falhou antes de chegar nele.
	for _, g := range guids {
		repMu.Lock()
		done := reported[strings.ToLower(g)]
		repMu.Unlock()
		if !done {
			detail := "nao processada"
			if err != nil {
				detail = err.Error()
			}
			report(InstallResult{GUID: g, Detail: detail})
		}
	}
	cancel()

	putCtx, putCancel := context.WithTimeout(parent, reportTimeout)
	if perr := s.api.Put(putCtx, pathWinUpdates, map[string]any{"agent_id": s.agentID, "needs_reboot": reboot}, nil); perr != nil {
		s.log.Warn("falha ao informar necessidade de reinicio", "erro", perr)
	}
	putCancel()
	s.log.Info("instalacao de atualizacoes concluida", "reinicio", reboot, "duracao", time.Since(start).Round(time.Second))
	s.mu.Unlock()

	if s.refresh != nil {
		s.refresh()
	}
	// Sem reinicio pendente, a lista e atualizada ja (novas atualizacoes podem ter surgido).
	// Com reinicio pendente, a varredura espera a maquina voltar (o checkin da partida a dispara).
	if !reboot {
		s.requestScan()
	}
}

func (s *service) patchResult(parent context.Context, guid string, success bool) {
	ctx, cancel := context.WithTimeout(parent, reportTimeout)
	defer cancel()
	body := map[string]any{"agent_id": s.agentID, "guid": guid, "success": success}
	if err := s.api.Patch(ctx, pathWinUpdates, body, nil); err != nil {
		s.log.Warn("falha ao enviar resultado da atualizacao", "guid", guid, "erro", err)
	}
}

// buildPayload monta a lista wua_updates e a lista de GUIDs substituidos a informar.
//   - pendentes substituidas por outra pendente saem da lista e vao para superseded;
//   - GUIDs instalados por este processo aparecem como instalados;
//   - duplicados saem; as pendentes vem antes e as instaladas sao cortadas primeiro no limite.
func buildPayload(pending, installed []Update, installedHere, lastPending map[string]bool) ([]Update, []string) {
	supersededBy := map[string]bool{}
	for _, u := range pending {
		for _, g := range u.Supersedes {
			if g = normGUID(g); g != "" {
				supersededBy[g] = true
			}
		}
	}

	seen := map[string]bool{}
	items := make([]Update, 0, len(pending)+len(installed))
	supersededSet := map[string]bool{}
	for _, u := range pending {
		g := normGUID(u.GUID)
		if g == "" || seen[g] {
			continue
		}
		seen[g] = true
		if supersededBy[g] {
			supersededSet[g] = true
			continue
		}
		u = normalize(u)
		u.Installed = false
		if installedHere[g] {
			u.Installed = true
			u.Downloaded = true
		}
		items = append(items, u)
	}
	// Pendentes da varredura anterior que agora aparecem como substituidas.
	for g := range lastPending {
		if supersededBy[g] && !seen[g] {
			supersededSet[g] = true
		}
	}
	for _, u := range installed {
		if len(items) >= maxItems {
			break
		}
		g := normGUID(u.GUID)
		if g == "" || seen[g] {
			continue
		}
		seen[g] = true
		u = normalize(u)
		u.Installed = true
		items = append(items, u)
	}
	if len(items) > maxItems {
		items = items[:maxItems]
	}
	superseded := make([]string, 0, len(supersededSet))
	for g := range supersededSet {
		superseded = append(superseded, g)
	}
	sort.Strings(superseded)
	return items, superseded
}

// normalize garante listas nao nulas (o JSON sai [] e nao null), KB so com digitos e
// severidade na grafia que a politica de patch reconhece.
func normalize(u Update) Update {
	u.GUID = normGUID(u.GUID)
	kbs := make([]string, 0, len(u.KBArticleIDs))
	for _, k := range u.KBArticleIDs {
		if k = normKB(k); k != "" {
			kbs = append(kbs, k)
		}
	}
	u.KBArticleIDs = kbs
	u.Categories = nonNil(u.Categories)
	u.MoreInfoURLs = nonNil(u.MoreInfoURLs)
	u.Severity = normSeverity(u.Severity)
	u.Title = strings.TrimSpace(u.Title)
	u.Supersedes = nil
	return u
}

func nonNil(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// normKB tira o prefixo "KB" e qualquer coisa que nao seja digito.
func normKB(k string) string {
	k = strings.TrimSpace(k)
	if len(k) >= 2 && strings.EqualFold(k[:2], "kb") {
		k = k[2:]
	}
	var b strings.Builder
	for _, r := range k {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func normSeverity(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "critical":
		return "Critical"
	case "important":
		return "Important"
	case "moderate":
		return "Moderate"
	case "low":
		return "Low"
	}
	return strings.TrimSpace(s)
}

// normGUID devolve o GUID em minusculas, sem chaves, ou "" se nao for um GUID valido.
func normGUID(g string) string {
	g = strings.ToLower(strings.TrimSpace(g))
	g = strings.TrimSuffix(strings.TrimPrefix(g, "{"), "}")
	if !isGUID(g) {
		return ""
	}
	return g
}

// isGUID confere o formato 8-4-4-4-12 hexadecimal. Tambem protege o criterio de busca do WUA
// (UpdateID='...') contra injecao.
func isGUID(g string) bool {
	if len(g) != 36 {
		return false
	}
	for i, r := range g {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
		default:
			if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F') {
				return false
			}
		}
	}
	return true
}

// sanitizeGUIDs normaliza, descarta invalidos e duplicados e limita a quantidade.
func sanitizeGUIDs(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, g := range in {
		g = normGUID(g)
		if g == "" || seen[g] {
			continue
		}
		seen[g] = true
		out = append(out, g)
		if len(out) >= maxGUIDs {
			break
		}
	}
	return out
}

// filterByGUID devolve, na ordem de want, os itens cujo GUID foi pedido, e os GUIDs nao achados.
func filterByGUID[T any](items []T, guidOf func(T) string, want []string) (found []T, missing []string) {
	idx := map[string]int{}
	for i, it := range items {
		if g := normGUID(guidOf(it)); g != "" {
			if _, dup := idx[g]; !dup {
				idx[g] = i
			}
		}
	}
	for _, g := range want {
		if i, ok := idx[normGUID(g)]; ok {
			found = append(found, items[i])
		} else {
			missing = append(missing, g)
		}
	}
	return found, missing
}
