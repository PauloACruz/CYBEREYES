// Package install instala, atualiza e remove o EYES.
//
// Reinstalar sobre uma instalacao existente do mesmo servidor mantem a identidade do agente
// (nao cria um agente duplicado): so troca o binario e reinicia o servico.
package install

import (
	"context"
	"crypto/rand"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/big"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/config"
	"github.com/pauloacruz/cybereyes/agent/internal/mesh"
	"github.com/pauloacruz/cybereyes/agent/internal/service"
	"github.com/pauloacruz/cybereyes/agent/internal/version"
)

// Options sao os parametros de linha de comando da instalacao.
type Options struct {
	API       string
	ClientID  int
	SiteID    int
	AgentType string
	Auth      string
	APIKey    bool
	Desc      string
	NoMesh    bool
	Insecure  bool
	Proxy     string
	Silent    bool
	// NoService so registra e grava a configuracao (testes e containers); nao copia o binario
	// nem cria o servico. A pasta de dados pode ser trocada com EYES_DATA_DIR.
	NoService bool
	NatsURL   string
}

func parse(args []string) (Options, error) {
	var o Options
	fs := flag.NewFlagSet("install", flag.ContinueOnError)
	fs.StringVar(&o.API, "api", "", "endereco do servidor (https://...)")
	fs.IntVar(&o.ClientID, "client-id", 0, "cliente")
	fs.IntVar(&o.SiteID, "site-id", 0, "site")
	fs.StringVar(&o.AgentType, "agent-type", "server", "server ou workstation")
	fs.StringVar(&o.Auth, "auth", "", "token de instalacao")
	fs.BoolVar(&o.APIKey, "api-key", false, "--auth e uma chave de API (X-API-KEY)")
	fs.StringVar(&o.Desc, "desc", "", "descricao do agente")
	fs.BoolVar(&o.NoMesh, "nomesh", false, "nao instalar o MeshAgent")
	fs.BoolVar(&o.Insecure, "insecure", false, "nao verificar o certificado TLS (laboratorio)")
	fs.StringVar(&o.Proxy, "proxy", "", "proxy HTTP")
	fs.BoolVar(&o.Silent, "silent", false, "sem mensagens de progresso")
	fs.BoolVar(&o.NoService, "no-service", false, "somente registrar (sem servico nem MeshAgent)")
	fs.StringVar(&o.NatsURL, "nats-url", "", "endereco do NATS (padrao wss://<host>/natsws)")
	if err := fs.Parse(args); err != nil {
		return o, err
	}
	o.API = strings.TrimRight(strings.TrimSpace(o.API), "/")
	if o.API == "" || o.Auth == "" || o.SiteID == 0 {
		return o, errors.New("informe --api, --site-id e --auth")
	}
	if o.AgentType != "server" && o.AgentType != "workstation" {
		return o, fmt.Errorf("--agent-type deve ser server ou workstation (recebido %q)", o.AgentType)
	}
	return o, nil
}

// Install executa a instalacao completa.
func Install(args []string) error {
	o, err := parse(args)
	if err != nil {
		return err
	}
	if o.NoService {
		o.NoMesh = true
	} else if !isAdmin() {
		return errors.New("execute como administrador (Windows) ou root (Linux e macOS)")
	}
	say := func(format string, a ...any) {
		if !o.Silent {
			fmt.Printf(format+"\n", a...)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	opts := api.Options{Insecure: o.Insecure, Proxy: o.Proxy}

	inst, err := api.NewInstaller(o.API, o.Auth, o.APIKey, opts)
	if err != nil {
		return err
	}
	say("Verificando o servidor %s...", o.API)
	if err := inst.Get(ctx, "/api/v3/installer/", nil); err != nil {
		if api.IsStatus(err, 401) || api.IsStatus(err, 403) {
			return errors.New("token de instalacao invalido ou expirado: gere um novo comando no console")
		}
		return fmt.Errorf("servidor inacessivel: %w", err)
	}
	if err := inst.Post(ctx, "/api/v3/installer/", map[string]string{"version": version.Version}, nil); err != nil {
		return err
	}

	existing, _ := config.Load()
	reuse := existing != nil && strings.EqualFold(existing.API, o.API) && identityValid(ctx, existing, opts)

	bin := ""
	if !o.NoService {
		if err := stopExisting(); err != nil {
			say("Aviso: nao foi possivel parar o servico atual: %v", err)
		}
		if bin, err = copySelf(); err != nil {
			return fmt.Errorf("falha ao copiar o binario: %w", err)
		}
		say("Binario instalado em %s", bin)
	}

	cfg := existing
	if reuse {
		say("Instalacao existente encontrada: mantendo o agente %s", existing.AgentID)
		cfg.Insecure, cfg.Proxy, cfg.NatsURL = o.Insecure, o.Proxy, o.NatsURL
	} else {
		cfg = &config.Config{API: o.API, ClientID: o.ClientID, SiteID: o.SiteID, AgentType: o.AgentType, Insecure: o.Insecure, Proxy: o.Proxy, NoMesh: o.NoMesh, NatsURL: o.NatsURL}
		cfg.AgentID = NewAgentID()
	}

	meshNode := ""
	if !o.NoMesh {
		say("Instalando o MeshAgent (acesso remoto)...")
		if node, err := installMesh(ctx, inst, say); err != nil {
			say("Aviso: MeshAgent nao instalado: %v", err)
		} else {
			meshNode = node
		}
	}

	if !reuse {
		host, _ := os.Hostname()
		say("Registrando o agente...")
		var reg struct {
			PK    int    `json:"pk"`
			Token string `json:"token"`
		}
		body := map[string]any{
			"agent_id":        cfg.AgentID,
			"hostname":        host,
			"site":            strconv.Itoa(o.SiteID),
			"monitoring_type": o.AgentType,
			"mesh_node_id":    meshNode,
			"description":     o.Desc,
			"goarch":          runtime.GOARCH,
			"plat":            runtime.GOOS,
		}
		if err := inst.Post(ctx, "/api/v3/newagent/", body, &reg); err != nil {
			return fmt.Errorf("registro recusado: %w", err)
		}
		if reg.Token == "" {
			return errors.New("o servidor nao devolveu o token do agente")
		}
		cfg.PK, cfg.Token = reg.PK, reg.Token
	}
	if err := cfg.Save(); err != nil {
		return fmt.Errorf("falha ao gravar a configuracao: %w", err)
	}
	if meshNode != "" {
		if c, err := api.New(cfg.API, cfg.Token, opts); err == nil {
			_ = c.Post(ctx, "/api/v3/syncmesh/", map[string]string{"nodeid": meshNode}, nil)
		}
	}

	if o.NoService {
		say("Agente %s registrado (sem servico). Configuracao em %s", cfg.AgentID, config.File())
		return nil
	}
	say("Registrando o servico %s...", service.Name)
	if err := service.Install(bin); err != nil {
		return fmt.Errorf("falha ao registrar o servico: %w", err)
	}
	say("EYES %s instalado (agente %s).", version.Version, cfg.AgentID)
	return nil
}

// identityValid confere se o token guardado ainda e aceito pelo servidor.
func identityValid(ctx context.Context, c *config.Config, opts api.Options) bool {
	client, err := api.New(c.API, c.Token, opts)
	if err != nil {
		return false
	}
	return client.Get(ctx, "/api/v3/"+c.AgentID+"/config/", nil) == nil
}

// installMesh instala o MeshAgent do grupo do Cybereyes. Um MeshAgent ja instalado so e mantido se
// apontar para o mesmo servidor e grupo; um de outro servidor (por exemplo do Tactical) e substituido.
func installMesh(ctx context.Context, inst *api.Client, say func(string, ...any)) (string, error) {
	file, err := mesh.Download(ctx, inst, "POST", "/api/v3/meshexe/", map[string]string{"plat": runtime.GOOS, "goarch": runtime.GOARCH})
	if err != nil {
		return "", err
	}
	defer os.Remove(file)
	if mesh.Binary() != "" {
		want, have := mesh.EmbeddedSettings(file), mesh.InstalledSettings()
		if want.Valid() && have.Valid() && want.Same(have) {
			if node, err := mesh.NodeID(ctx); err == nil {
				say("MeshAgent do Cybereyes ja instalado.")
				return node, nil
			}
		}
		say("Substituindo o MeshAgent existente (servidor %q) pelo do Cybereyes...", have.Server)
		if err := mesh.Uninstall(ctx); err != nil {
			say("Aviso: falha ao remover o MeshAgent anterior: %v", err)
		}
	}
	if err := mesh.Install(ctx, file); err != nil {
		return "", err
	}
	// O MeshAgent gera o certificado do no na primeira partida.
	var last error
	for i := 0; i < 20; i++ {
		node, err := mesh.NodeID(ctx)
		if err == nil {
			return node, nil
		}
		last = err
		time.Sleep(3 * time.Second)
	}
	return "", last
}

func stopExisting() error {
	if _, err := os.Stat(config.BinaryPath()); err != nil {
		return nil
	}
	return service.Stop()
}

// copySelf copia o executavel atual para a pasta de instalacao (troca atomica).
func copySelf() (string, error) {
	self, err := os.Executable()
	if err != nil {
		return "", err
	}
	self, _ = filepath.EvalSymlinks(self)
	dest := config.BinaryPath()
	if same(self, dest) {
		return dest, nil
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return "", err
	}
	src, err := os.Open(self)
	if err != nil {
		return "", err
	}
	defer src.Close()
	tmp := dest + ".new"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(out, src); err != nil {
		out.Close()
		return "", err
	}
	if err := out.Close(); err != nil {
		return "", err
	}
	if runtime.GOOS == "windows" {
		// O binario antigo pode estar em uso: renomeia para .old antes de substituir.
		_ = os.Remove(dest + ".old")
		if _, err := os.Stat(dest); err == nil {
			if err := os.Rename(dest, dest+".old"); err != nil {
				return "", err
			}
		}
	}
	if err := os.Rename(tmp, dest); err != nil {
		return "", err
	}
	return dest, nil
}

func same(a, b string) bool {
	sa, err1 := os.Stat(a)
	sb, err2 := os.Stat(b)
	return err1 == nil && err2 == nil && os.SameFile(sa, sb)
}

const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

// NewAgentID gera o identificador de 40 letras do agente.
func NewAgentID() string {
	b := make([]byte, 40)
	max := big.NewInt(int64(len(letters)))
	for i := range b {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			panic(err)
		}
		b[i] = letters[n.Int64()]
	}
	return string(b)
}

// Uninstall remove o servico, a configuracao e o binario. --keep-mesh preserva o MeshAgent.
func Uninstall(args []string) error {
	fs := flag.NewFlagSet("uninstall", flag.ContinueOnError)
	keepMesh := fs.Bool("keep-mesh", false, "manter o MeshAgent")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if !isAdmin() {
		return errors.New("execute como administrador (Windows) ou root (Linux e macOS)")
	}
	if err := service.Uninstall(); err != nil {
		fmt.Println("Aviso:", err)
	}
	if !*keepMesh {
		if err := mesh.Uninstall(context.Background()); err != nil {
			fmt.Println("Aviso:", err)
		}
	}
	_ = os.RemoveAll(config.DataDir())
	removeInstallDir()
	fmt.Println("EYES removido.")
	return nil
}
