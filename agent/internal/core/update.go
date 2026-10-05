package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/pauloacruz/cybereyes/agent/internal/config"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
	"github.com/pauloacruz/cybereyes/agent/internal/service"
	"github.com/pauloacruz/cybereyes/agent/internal/version"
)

// update baixa a versao pedida do proprio servidor, confere o SHA-256 (quando informado),
// valida o binario novo e troca o executavel, reiniciando o servico.
// Payload: version (obrigatorio), sha256 (opcional).
func update(ctx context.Context, e *env.Env, req rpc.Request) any {
	p := req.Payload()
	want := p.Str("version")
	if want == "" {
		want = req.Str("version")
	}
	if want == "" {
		return "error: versao nao informada"
	}
	if want == version.Version {
		return "ok"
	}
	dest := currentBinary()
	tmp := dest + ".update"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return "error: " + err.Error()
	}
	h := sha256.New()
	_, err = e.API.Download(ctx, "GET", "/api/agent/download/"+runtime.GOOS+"/"+runtime.GOARCH, nil, io.MultiWriter(f, h))
	f.Close()
	if err != nil {
		os.Remove(tmp)
		return "error: download: " + err.Error()
	}
	if sum := strings.ToLower(p.Str("sha256")); sum != "" && sum != hex.EncodeToString(h.Sum(nil)) {
		os.Remove(tmp)
		return "error: SHA-256 do binario baixado nao confere"
	}
	out, err := exec.CommandContext(ctx, tmp, "version").Output()
	if err != nil || !strings.Contains(string(out), want) {
		os.Remove(tmp)
		return fmt.Sprintf("error: binario baixado invalido ou de outra versao (%s)", strings.TrimSpace(string(out)))
	}
	if runtime.GOOS == "windows" {
		old := dest + ".old"
		_ = os.Remove(old)
		if err := os.Rename(dest, old); err != nil {
			os.Remove(tmp)
			return "error: " + err.Error()
		}
	}
	if err := os.Rename(tmp, dest); err != nil {
		return "error: " + err.Error()
	}
	e.Log.Info("EYES atualizado; reiniciando", "de", version.Version, "para", want, "binario", filepath.Base(dest))
	if !e.Service {
		// Primeiro plano (eyes run): o proprio processo se reexecuta com o binario novo.
		go reexec(e, dest)
		return "ok"
	}
	if err := service.RestartDetached(); err != nil {
		return "error: binario trocado, mas o reinicio falhou: " + err.Error()
	}
	return "ok"
}

// currentBinary e o executavel em uso (o instalado, quando roda como servico).
func currentBinary() string {
	if self, err := os.Executable(); err == nil {
		if resolved, err := filepath.EvalSymlinks(self); err == nil {
			return resolved
		}
		return self
	}
	return config.BinaryPath()
}
