// Package service registra o EYES como servico do sistema operacional
// (Windows SCM, systemd ou OpenRC no Linux, launchd no macOS) e executa o laco principal.
package service

import (
	"context"
	"os"
	"os/signal"
	"syscall"
)

const (
	// Name e o nome do servico no sistema.
	Name = "eyes"
	// DisplayName e o nome exibido no Windows.
	DisplayName = "Cybereyes EYES"
	// Description descreve o servico.
	Description = "Agente de monitoramento e gerenciamento remoto do Cybereyes."
	// LaunchdLabel e o rotulo do launchd no macOS.
	LaunchdLabel = "br.com.cybereyes.eyes"
)

// RunFunc e o laco principal do agente; deve retornar quando ctx for cancelado.
type RunFunc func(ctx context.Context) error

// runForeground executa ate receber SIGINT ou SIGTERM.
func runForeground(run RunFunc) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return run(ctx)
}
