// Comando eyes: agente de monitoramento e gerenciamento remoto do Cybereyes.
//
//	eyes install --api https://servidor --client-id 1 --site-id 1 --agent-type server --auth TOKEN
//	eyes service      laco do agente (usado pelo servico do sistema)
//	eyes run          laco do agente em primeiro plano, com log no terminal
//	eyes uninstall    remove o servico, a configuracao e o binario
//	eyes version
package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/pauloacruz/cybereyes/agent/internal/agent"
	"github.com/pauloacruz/cybereyes/agent/internal/install"
	"github.com/pauloacruz/cybereyes/agent/internal/remote"
	"github.com/pauloacruz/cybereyes/agent/internal/service"
	"github.com/pauloacruz/cybereyes/agent/internal/version"
)

func main() {
	args := os.Args[1:]
	// Compatibilidade com o formato "-m install" usado por scripts antigos.
	if len(args) >= 2 && (args[0] == "-m" || args[0] == "--m") {
		args = append([]string{args[1]}, args[2:]...)
	}
	cmd := "help"
	if len(args) > 0 {
		cmd = strings.TrimLeft(args[0], "-")
		args = args[1:]
	}
	var err error
	switch cmd {
	case "install":
		err = install.Install(args)
	case "uninstall":
		err = install.Uninstall(args)
	case "service", "svc":
		err = service.Run(agent.Service)
	case "run":
		err = service.Run(agent.Foreground)
	case "remote-helper":
		// Processo auxiliar do acesso remoto, iniciado pelo servico na sessao grafica do usuario.
		err = remote.HelperMain(os.Stdin)
	case "version", "v":
		fmt.Println(version.Name, version.Version)
	case "help", "h":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "comando desconhecido: %s\n\n", cmd)
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "ERRO:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Printf(`%s %s - agente do Cybereyes

Uso:
  eyes install --api URL --client-id N --site-id N --agent-type server|workstation --auth TOKEN
               [--desc TEXTO] [--insecure] [--proxy URL] [--api-key]
  eyes uninstall [--keep-mesh]
  eyes service     (executado pelo servico do sistema)
  eyes run         (primeiro plano, para diagnostico)
  eyes version
`, version.Name, version.Version)
}
