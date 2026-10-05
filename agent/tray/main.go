// eyes-tray e o app de bandeja do usuario final: abre chamados, conversa com o tecnico e
// recebe avisos. O token vem do servico do agente pelo canal local e nunca chega ao JavaScript.
package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"os"
	"runtime"
	"slices"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var frontendFS embed.FS

//go:embed build/tray.png
var trayIcon []byte

//go:embed build/appicon.png
var appIcon []byte

// version e a versao do EYES que distribuiu o app (-ldflags "-X main.version=<versao>").
var version = "dev"

// singleInstanceKey cifra a mensagem que a segunda instancia envia a primeira (so para a mesma sessao).
var singleInstanceKey = [32]byte{
	0x57, 0x69, 0x6e, 0x43, 0x61, 0x72, 0x65, 0x2d, 0x74, 0x72, 0x61, 0x79, 0x2d, 0x73, 0x69, 0x6e,
	0x67, 0x6c, 0x65, 0x2d, 0x69, 0x6e, 0x73, 0x74, 0x61, 0x6e, 0x63, 0x65, 0x2d, 0x6b, 0x65, 0x79,
}

func main() {
	// --version sai antes de iniciar a interface: o agente usa para validar o binario baixado e,
	// no Linux, para saber se as bibliotecas do sistema (GTK e WebKitGTK) estao instaladas.
	if slices.Contains(os.Args[1:], "--version") {
		fmt.Println("eyes-tray", version)
		return
	}
	log.Printf("eyes-tray %s", version)
	insecure := os.Getenv("EYES_TRAY_INSECURE") == "1"
	if insecure {
		log.Println("AVISO: EYES_TRAY_INSECURE=1, certificados TLS nao serao validados (somente para testes)")
	}
	startHidden := slices.Contains(os.Args[1:], "--hidden")

	assets, err := fs.Sub(frontendFS, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}

	svc := newTrayService(insecure)
	svc.notifier = newNotifier()

	var window *application.WebviewWindow
	showWindow := func() {
		if window == nil {
			return
		}
		window.Show()
		window.Restore()
		window.Focus()
	}

	app := application.New(application.Options{
		Name:        "EYES",
		Description: "Atendimento EYES",
		Icon:        appIcon,
		Services: []application.Service{
			application.NewService(svc.notifier),
			application.NewService(svc),
		},
		Assets: application.AssetOptions{Handler: application.AssetFileServerFS(assets)},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID:      "br.com.cybereyes.eyes.tray",
			EncryptionKey: singleInstanceKey,
			// O agente reinicia o app com --hidden; so quem abre pelo menu ou atalho ve a janela.
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				if !slices.Contains(data.Args, "--hidden") {
					showWindow()
				}
			},
		},
		Mac: application.MacOptions{
			ActivationPolicy: application.ActivationPolicyAccessory,
		},
		Windows: application.WindowsOptions{DisableQuitOnLastWindowClosed: true},
		Linux:   application.LinuxOptions{DisableQuitOnLastWindowClosed: true, ProgramName: "eyes-tray"},
	})
	svc.app = app

	window = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "main",
		Title:            "EYES",
		Width:            420,
		Height:           640,
		MinWidth:         360,
		MinHeight:        480,
		Hidden:           startHidden,
		BackgroundColour: application.NewRGB(246, 247, 249),
		URL:              "/",
	})
	svc.window = window

	// Fechar a janela so esconde; o app continua na bandeja ate "Sair".
	window.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		window.Hide()
		e.Cancel()
	})

	navigate := func(view string, id int) {
		showWindow()
		app.Event.Emit(eventNavigate, map[string]any{"view": view, "id": id})
	}
	svc.notifier.onClick = func(ticketID int) {
		if ticketID > 0 {
			navigate("ticket", ticketID)
			return
		}
		showWindow()
	}

	menu := app.NewMenu()
	menu.Add("Abrir EYES").OnClick(func(*application.Context) { showWindow() })
	menu.Add("Novo chamado").OnClick(func(*application.Context) { navigate("new", 0) })
	menu.AddSeparator()
	menu.Add("Sair").OnClick(func(*application.Context) { app.Quit() })

	tray := app.SystemTray.New()
	tray.SetTooltip("EYES")
	if runtime.GOOS == "darwin" {
		tray.SetTemplateIcon(trayIcon)
	} else {
		tray.SetIcon(trayIcon)
	}
	tray.SetMenu(menu)
	tray.OnClick(showWindow)

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
