//go:build windows || linux

package tray

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/config"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/version"
)

// O eyes-tray e baixado da propria API (/api/agent/download/<plat>/<arch>?component=tray) para a pasta
// de instalacao do EYES, de novo a cada versao nova do agente.

func trayPath() string { return filepath.Join(config.InstallDir(), trayExe) }

func versionFile() string { return filepath.Join(config.InstallDir(), "eyes-tray.version") }

// ensureBinary baixa o eyes-tray quando falta ou e de outra versao do EYES. Devolve true quando trocou
// o binario (swapBinary ja encerrou as instancias da versao antiga; o supervisor inicia a nova).
func ensureBinary(ctx context.Context, e *env.Env) bool {
	if data, err := os.ReadFile(versionFile()); err == nil && strings.TrimSpace(string(data)) == version.Version {
		if _, err := os.Stat(trayPath()); err == nil {
			return false
		}
	}
	tmp := trayPath() + ".download"
	_ = os.MkdirAll(filepath.Dir(tmp), 0o755)
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		e.Log.Warn("app de bandeja: falha ao criar o arquivo", "erro", err)
		return false
	}
	dctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	n, err := e.API.Download(dctx, "GET", "/api/agent/download/"+runtime.GOOS+"/"+runtime.GOARCH+"?component=tray", nil, f)
	f.Close()
	if err != nil || n < 1<<20 {
		os.Remove(tmp)
		e.Log.Info("app de bandeja indisponivel no servidor", "erro", err)
		return false
	}
	if err := swapBinary(tmp); err != nil {
		os.Remove(tmp)
		e.Log.Warn("app de bandeja: falha ao instalar", "erro", err)
		return false
	}
	_ = os.WriteFile(versionFile(), []byte(version.Version), 0o644)
	e.Log.Info("app de bandeja atualizado", "versao", version.Version)
	return true
}
