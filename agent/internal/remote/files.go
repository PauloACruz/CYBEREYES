package remote

import (
	"context"
	"log/slog"
	"runtime"

	"github.com/pauloacruz/cybereyes/agent/internal/remote/files"
)

// runFiles atende o canal files no servico (contrato, secao 7): o servico (SYSTEM ou root) le e grava os arquivos
// e entrega ao usuario da sessao o que criar. Os arquivos colados no visualizador vao para a area de transferencia
// da sessao pelo remote-helper (so Windows na v1).
func runFiles(ctx context.Context, p HelperParams, t target, control chan<- Control, desktop bool, log *slog.Logger) error {
	conn, err := dialRelay(ctx, p, "files")
	if err != nil {
		return err
	}
	defer conn.CloseNow()
	if err := authenticate(ctx, conn, p.Token); err != nil {
		return err
	}
	conn.SetReadLimit(files.ChunkSize + 1024)
	svc := &files.Service{
		User:   files.User{Name: t.User, Session: t.Session},
		Policy: files.Policy{Upload: p.Policy.FilesUpload, Download: p.Policy.FilesDownload, MaxBytes: int64(p.Policy.MaxFileMb) << 20},
		Log:    log,
	}
	if desktop && runtime.GOOS == "windows" {
		svc.ClipboardFiles = func(paths []string) error {
			select {
			case control <- Control{ClipboardFiles: paths}:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}
	return svc.Serve(ctx, conn)
}
