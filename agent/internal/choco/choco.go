// Package choco integra o EYES ao Chocolatey no Windows: instalacao do proprio Chocolatey
// (installchoco) e de pacotes pedidos no console (installwithchoco).
// Contrato: docs/agente/contrato-eyes.md, secoes 3.4, 3.8 e 4.3.
package choco

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/execx"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// Tempos e limites.
const (
	// installChocoTimeout limita o download e a execucao do install.ps1 oficial.
	installChocoTimeout = 20 * time.Minute
	// packageTimeout limita um "choco install <pacote>".
	packageTimeout = 45 * time.Minute
	// reportTimeout limita cada chamada REST.
	reportTimeout = 2 * time.Minute
	// maxResult limita o texto enviado em results (guarda o final, onde ficam os erros).
	maxResult = 512 << 10
	// maxPackageName limita o tamanho do nome do pacote.
	maxPackageName = 100
)

// InstallScriptURL e o script oficial de instalacao do Chocolatey.
const InstallScriptURL = "https://community.chocolatey.org/install.ps1"

// ErrUnsupported e devolvido fora do Windows.
var ErrUnsupported = errors.New("somente Windows")

// packageRe aceita so letras, digitos, ponto, hifen e sublinhado, comecando por letra ou
// digito (um nome iniciado por "-" viraria opcao do choco).
var packageRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

// ValidPackageName informa se o nome do pacote pode ir com seguranca para a linha de comando.
func ValidPackageName(name string) bool {
	return len(name) <= maxPackageName && packageRe.MatchString(name)
}

// system e a ponte com o Chocolatey local (Windows de verdade ou falso nos testes).
type system interface {
	// Find devolve o caminho do choco.exe, se instalado.
	Find() (string, bool)
	// InstallChoco executa o script oficial de instalacao.
	InstallChoco(ctx context.Context) execx.Result
	// InstallPackage executa "choco install <pkg> -y --no-progress".
	InstallPackage(ctx context.Context, chocoPath, pkg string) execx.Result
}

// rest e o subconjunto do cliente REST usado aqui (*api.Client o satisfaz).
type rest interface {
	Post(ctx context.Context, path string, body, out any) error
	Patch(ctx context.Context, path string, body, out any) error
}

type service struct {
	sys     system
	api     rest
	agentID string
	log     *slog.Logger
	spawn   func(name string, fn func(ctx context.Context))

	// mu serializa as operacoes do Chocolatey (ele usa uma trava propria e falha em paralelo).
	mu sync.Mutex
	// installQueued junta os installchoco repetidos (o servidor reenvia a cada checkin).
	installQueued atomic.Bool
}

func newService(e *env.Env, sys system) *service {
	return &service{
		sys:     sys,
		api:     e.API,
		agentID: e.Cfg.AgentID,
		log:     e.Log.With("modulo", "choco"),
		spawn:   e.Go,
	}
}

// register liga os comandos. Ambos chegam por publish; o trabalho segue em segundo plano.
func (s *service) register(reg *rpc.Registry) {
	reg.HandleTimeout("installchoco", 10*time.Second, func(context.Context, rpc.Request) any {
		s.requestInstallChoco()
		return "ok"
	})
	reg.HandleTimeout("installwithchoco", 10*time.Second, func(_ context.Context, req rpc.Request) any {
		pkg := strings.TrimSpace(req.Str("choco_prog_name"))
		pk := req.Int("pending_action_pk")
		if pk <= 0 {
			s.log.Warn("installwithchoco sem pending_action_pk valido", "pacote", pkg)
			return "error: pending_action_pk invalido"
		}
		s.spawn("choco-install-package", func(ctx context.Context) { s.installPackage(ctx, pkg, pk) })
		return "ok"
	})
}

// requestInstallChoco agenda a instalacao do Chocolatey, juntando pedidos repetidos.
func (s *service) requestInstallChoco() {
	if !s.installQueued.CompareAndSwap(false, true) {
		return
	}
	s.spawn("choco-install", func(ctx context.Context) {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.installQueued.Store(false)
		_, ok, _ := s.ensure(ctx)
		s.reportInstalled(ctx, ok)
	})
}

// ensure devolve o caminho do choco.exe, instalando o Chocolatey se faltar. installedNow indica
// que a instalacao aconteceu nesta chamada. Chamado com s.mu travado.
func (s *service) ensure(ctx context.Context) (path string, ok, installedNow bool) {
	if p, found := s.sys.Find(); found {
		return p, true, false
	}
	s.log.Info("instalando o Chocolatey")
	res := s.sys.InstallChoco(ctx)
	if p, found := s.sys.Find(); found {
		s.log.Info("Chocolatey instalado", "caminho", p, "duracao", res.Elapsed.Round(time.Second))
		return p, true, true
	}
	s.log.Warn("falha ao instalar o Chocolatey", "codigo", res.ExitCode, "erro", res.Err, "saida", tail(res.Combined(), 2000))
	return "", false, false
}

// reportInstalled envia POST /api/v3/choco/ {installed}.
func (s *service) reportInstalled(parent context.Context, installed bool) {
	ctx, cancel := context.WithTimeout(parent, reportTimeout)
	defer cancel()
	if err := s.api.Post(ctx, "/api/v3/choco/", map[string]any{"agent_id": s.agentID, "installed": installed}, nil); err != nil {
		s.log.Warn("falha ao informar o estado do Chocolatey", "erro", err)
	}
}

// installPackage instala o pacote e envia PATCH /api/v4/{agent_id}/{pk}/chocoresult/.
func (s *service) installPackage(ctx context.Context, pkg string, pk int) {
	if !ValidPackageName(pkg) {
		s.log.Warn("nome de pacote recusado", "pacote", pkg)
		s.reportResult(ctx, pk, fmt.Sprintf("error: nome de pacote invalido: %q (use so letras, digitos, ponto, hifen e sublinhado)", pkg))
		return
	}
	s.mu.Lock()
	choco, ok, installedNow := s.ensure(ctx)
	if installedNow {
		s.reportInstalled(ctx, true)
	}
	var out string
	if !ok {
		out = "error: Chocolatey nao esta instalado e a instalacao automatica falhou"
	} else {
		s.log.Info("instalando pacote pelo Chocolatey", "pacote", pkg)
		res := s.sys.InstallPackage(ctx, choco, pkg)
		out = formatResult(res)
		s.log.Info("pacote processado pelo Chocolatey", "pacote", pkg, "codigo", res.ExitCode, "duracao", res.Elapsed.Round(time.Second))
	}
	s.mu.Unlock()
	s.reportResult(ctx, pk, out)
}

func (s *service) reportResult(parent context.Context, pk int, results string) {
	ctx, cancel := context.WithTimeout(parent, reportTimeout)
	defer cancel()
	if err := s.api.Patch(ctx, resultPath(s.agentID, pk), map[string]any{"results": results}, nil); err != nil {
		s.log.Warn("falha ao enviar o resultado do Chocolatey", "pk", pk, "erro", err)
	}
}

// resultPath monta a rota da secao 3.8: agent_id antes do pk.
func resultPath(agentID string, pk int) string {
	return fmt.Sprintf("/api/v4/%s/%d/chocoresult/", url.PathEscape(agentID), pk)
}

// Codigos de saida do choco que indicam sucesso com reinicio pendente.
var rebootCodes = map[int]bool{1641: true, 3010: true}

// formatResult monta o texto gravado na acao pendente.
func formatResult(res execx.Result) string {
	out := strings.TrimSpace(res.Combined())
	var note string
	switch {
	case res.Err != nil && !res.TimedOut:
		note = "error: " + res.Err.Error()
	case res.TimedOut:
		note = fmt.Sprintf("error: tempo limite de %s excedido", packageTimeout)
	case rebootCodes[res.ExitCode]:
		note = fmt.Sprintf("Instalado; reinicio necessario (codigo %d)", res.ExitCode)
	case res.ExitCode != 0:
		note = fmt.Sprintf("error: choco terminou com codigo %d", res.ExitCode)
	}
	if note != "" {
		if out != "" {
			out += "\n\n"
		}
		out += note
	}
	if out == "" {
		out = "ok"
	}
	return tail(out, maxResult)
}

// tail guarda os ultimos n bytes de s, sem cortar um caractere ao meio.
func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	cut := len(s) - n
	for cut < len(s) && (s[cut]&0xC0) == 0x80 {
		cut++
	}
	return "[inicio da saida omitido]\n" + s[cut:]
}

// packageArgs monta os argumentos do choco.exe (sem shell no meio).
func packageArgs(pkg string) []string {
	return []string{"install", pkg, "-y", "--no-progress"}
}

// installCommand monta o comando do PowerShell. O proxy vem da configuracao local do agente.
func installCommand(proxy string) string {
	var b strings.Builder
	b.WriteString("$ErrorActionPreference='Stop';")
	b.WriteString("Set-ExecutionPolicy Bypass -Scope Process -Force;")
	b.WriteString("[System.Net.ServicePointManager]::SecurityProtocol=[System.Net.ServicePointManager]::SecurityProtocol -bor 3072;")
	if proxy != "" {
		q := psQuote(proxy)
		b.WriteString("$env:chocolateyProxyLocation=" + q + ";")
		b.WriteString("[System.Net.WebRequest]::DefaultWebProxy=New-Object System.Net.WebProxy(" + q + ");")
	}
	b.WriteString("iex ((New-Object System.Net.WebClient).DownloadString('" + InstallScriptURL + "'))")
	return b.String()
}

// psQuote coloca s entre aspas simples do PowerShell.
func psQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
