// Package winget instala no Windows os pacotes pedidos no console pelo Windows Package Manager
// (installwithwinget). O EYES roda como SYSTEM: o winget.exe e procurado na pasta do App Installer,
// fora do PATH. Contrato: docs/agente/contrato-eyes.md, secoes 3.4 e 3.8.
package winget

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/execx"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// Tempos e limites.
const (
	// packageTimeout limita um "winget install".
	packageTimeout = 45 * time.Minute
	// reportTimeout limita a chamada REST do resultado.
	reportTimeout = 2 * time.Minute
	// maxResult limita o texto enviado em results (guarda o final, onde ficam os erros).
	maxResult = 512 << 10
	// maxID limita o tamanho do identificador do pacote.
	maxID = 128
)

// Codigos de saida do winget (HRESULT) tratados de forma especial.
const (
	// errNoApplicableInstaller: nenhum instalador para o escopo pedido (tenta de novo sem --scope).
	errNoApplicableInstaller = 0x8A150014
	// errAlreadyInstalled: o pacote ja esta instalado.
	errAlreadyInstalled = 0x8A150061
)

// ErrUnsupported e devolvido fora do Windows.
var ErrUnsupported = errors.New("somente Windows")

// idRe aceita o formato dos identificadores do winget (Google.Chrome, 7zip.7zip, Notepad++.Notepad++),
// comecando por letra ou digito para nao virar opcao da linha de comando.
var idRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]*$`)

// ValidID informa se o identificador pode ir com seguranca para a linha de comando.
func ValidID(id string) bool {
	return len(id) <= maxID && idRe.MatchString(id)
}

// system e a ponte com o winget local (Windows de verdade ou falso nos testes).
type system interface {
	// Find devolve o caminho do winget.exe, se o App Installer estiver presente.
	Find() (string, bool)
	// Install executa o winget com os argumentos dados.
	Install(ctx context.Context, wingetPath string, args []string) execx.Result
}

// rest e o subconjunto do cliente REST usado aqui (*api.Client o satisfaz).
type rest interface {
	Patch(ctx context.Context, path string, body, out any) error
}

type service struct {
	sys     system
	api     rest
	agentID string
	log     *slog.Logger
	spawn   func(name string, fn func(ctx context.Context))

	// mu serializa as instalacoes (instaladores MSI nao rodam em paralelo).
	mu sync.Mutex
}

func newService(e *env.Env, sys system) *service {
	return &service{sys: sys, api: e.API, agentID: e.Cfg.AgentID, log: e.Log.With("modulo", "winget"), spawn: e.Go}
}

// register liga o installwithwinget. Chega por publish; a instalacao segue em segundo plano.
func (s *service) register(reg *rpc.Registry) {
	reg.HandleTimeout("installwithwinget", 10*time.Second, func(_ context.Context, req rpc.Request) any {
		id := strings.TrimSpace(req.Str("winget_id"))
		pk := req.Int("pending_action_pk")
		if pk <= 0 {
			s.log.Warn("installwithwinget sem pending_action_pk valido", "pacote", id)
			return "error: pending_action_pk invalido"
		}
		s.spawn("winget-install", func(ctx context.Context) { s.install(ctx, id, pk) })
		return "ok"
	})
}

// install instala o pacote e envia PATCH /api/v4/{agent_id}/{pk}/wingetresult/.
func (s *service) install(ctx context.Context, id string, pk int) {
	if !ValidID(id) {
		s.log.Warn("identificador de pacote recusado", "pacote", id)
		s.report(ctx, pk, fmt.Sprintf("error: identificador de pacote invalido: %q", id))
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	path, ok := s.sys.Find()
	if !ok {
		s.report(ctx, pk, "error: winget nao encontrado nesta maquina (instale o App Installer da Microsoft Store; Windows 10 1809 ou mais novo)")
		return
	}
	s.log.Info("instalando pacote pelo winget", "pacote", id)
	res := s.sys.Install(ctx, path, installArgs(id, true))
	if uint32(res.ExitCode) == errNoApplicableInstaller && res.Err == nil && !res.TimedOut {
		// Pacote sem instalador para a maquina toda: tenta o escopo padrao do pacote.
		s.log.Info("sem instalador para a maquina toda; tentando o escopo padrao", "pacote", id)
		res = s.sys.Install(ctx, path, installArgs(id, false))
	}
	s.log.Info("pacote processado pelo winget", "pacote", id, "codigo", fmt.Sprintf("0x%X", uint32(res.ExitCode)), "duracao", res.Elapsed.Round(time.Second))
	s.report(ctx, pk, formatResult(res))
}

func (s *service) report(parent context.Context, pk int, results string) {
	ctx, cancel := context.WithTimeout(parent, reportTimeout)
	defer cancel()
	if err := s.api.Patch(ctx, resultPath(s.agentID, pk), map[string]any{"results": results}, nil); err != nil {
		s.log.Warn("falha ao enviar o resultado do winget", "pk", pk, "erro", err)
	}
}

func resultPath(agentID string, pk int) string {
	return fmt.Sprintf("/api/v4/%s/%d/wingetresult/", url.PathEscape(agentID), pk)
}

// installArgs monta a linha do winget: identificador exato, fonte winget (a msstore pede conta),
// silencioso e sem perguntas. machine pede o escopo da maquina toda (o EYES roda como SYSTEM).
func installArgs(id string, machine bool) []string {
	args := []string{"install", "--id", id, "--exact", "--source", "winget", "--silent", "--disable-interactivity",
		"--accept-package-agreements", "--accept-source-agreements"}
	if machine {
		args = append(args, "--scope", "machine")
	}
	return args
}

// Codigos de saida de instaladores que indicam sucesso com reinicio pendente.
var rebootCodes = map[uint32]bool{1641: true, 3010: true}

// formatResult monta o texto gravado na acao pendente. Comeca com "error:" quando falhou.
func formatResult(res execx.Result) string {
	out := cleanOutput(res.Combined())
	code := uint32(res.ExitCode)
	var note string
	switch {
	case res.Err != nil && !res.TimedOut:
		note = "error: " + res.Err.Error()
	case res.TimedOut:
		note = fmt.Sprintf("error: tempo limite de %s excedido", packageTimeout)
	case code == errAlreadyInstalled:
		note = "O pacote ja esta instalado."
	case rebootCodes[code]:
		note = fmt.Sprintf("Instalado; reinicio necessario (codigo %d)", code)
	case code != 0:
		note = fmt.Sprintf("error: winget terminou com codigo 0x%08X", code)
	}
	switch {
	case strings.HasPrefix(note, "error:"):
		// O console marca a acao como falha pelo prefixo "error:": a nota vai na frente.
		if out != "" {
			out = note + "\n\n" + out
		} else {
			out = note
		}
	case note != "":
		if out != "" {
			out += "\n\n"
		}
		out += note
	case out == "":
		out = "ok"
	}
	return tail(out, maxResult)
}

// cleanOutput tira as linhas de progresso do winget (barras redesenhadas com \r e girandola).
func cleanOutput(s string) string {
	var lines []string
	for _, line := range strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n") {
		if i := strings.LastIndex(line, "\r"); i >= 0 {
			line = line[i+1:]
		}
		t := strings.TrimSpace(line)
		if t == "" || t == "-" || t == "\\" || t == "|" || t == "/" || strings.ContainsAny(t, "█▒") {
			continue
		}
		lines = append(lines, strings.TrimRight(line, " "))
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

// tail guarda os ultimos n bytes de s, sem cortar um caractere ao meio.
func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	cut := len(s) - n
	for cut < len(s) && s[cut]&0xC0 == 0x80 {
		cut++
	}
	return s[cut:]
}

// pickWinget escolhe a pasta de versao mais nova, preferindo a arquitetura do EYES.
func pickWinget(dirs []string, goarch string) string {
	arch := map[string]string{"amd64": "_x64__", "arm64": "_arm64__", "386": "_x86__"}[goarch]
	type cand struct {
		path    string
		version []int
		native  bool
	}
	var cs []cand
	for _, d := range dirs {
		exe := filepath.Join(d, "winget.exe")
		if st, err := os.Stat(exe); err != nil || st.IsDir() {
			continue
		}
		cs = append(cs, cand{exe, folderVersion(filepath.Base(d)), arch != "" && strings.Contains(filepath.Base(d), arch)})
	}
	sort.SliceStable(cs, func(i, j int) bool {
		if cs[i].native != cs[j].native {
			return cs[i].native
		}
		return newer(cs[i].version, cs[j].version)
	})
	if len(cs) == 0 {
		return ""
	}
	return cs[0].path
}

// folderVersion le a versao de "Microsoft.DesktopAppInstaller_1.22.10582.0_x64__8wekyb3d8bbwe".
func folderVersion(name string) []int {
	parts := strings.Split(name, "_")
	if len(parts) < 2 {
		return nil
	}
	var v []int
	for _, p := range strings.Split(parts[1], ".") {
		n, err := strconv.Atoi(p)
		if err != nil {
			return v
		}
		v = append(v, n)
	}
	return v
}

func newer(a, b []int) bool {
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return len(a) > len(b)
}
