//go:build windows

package remote

import (
	"errors"
	"fmt"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

func platformFeatures() []string { return []string{"cad"} }

// sessionUser informa ao visualizador quem esta na sessao (nulo na tela de login).
func sessionUser() *string {
	var sid uint32
	if windows.ProcessIdToSessionId(windows.GetCurrentProcessId(), &sid) != nil {
		return nil
	}
	if user := sessionAccount(sid); user != "" {
		return &user
	}
	return nil
}

var procSendSAS = windows.NewLazySystemDLL("sas.dll").NewProc("SendSAS")

const (
	sasPolicyKey   = `SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System`
	sasPolicyValue = "SoftwareSASGeneration"
	// Bit 1 da politica: servicos podem gerar a sequencia (2 = aplicativos de acessibilidade, 3 = os dois).
	sasServices = 1
)

// secureAttention envia Ctrl+Alt+Del com SendSAS. O Windows so aceita quando a politica SoftwareSASGeneration
// permite servicos; sem isso, a politica e ligada so durante a chamada e o valor anterior volta em seguida.
func secureAttention() error {
	if err := procSendSAS.Find(); err != nil {
		return errors.New("Ctrl+Alt+Del remoto indisponivel nesta versao do Windows")
	}
	k, _, err := registry.CreateKey(registry.LOCAL_MACHINE, sasPolicyKey, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("politica do Ctrl+Alt+Del: %w", err)
	}
	defer k.Close()
	old, _, gerr := k.GetIntegerValue(sasPolicyValue)
	if gerr != nil || old&sasServices == 0 {
		if err := k.SetDWordValue(sasPolicyValue, uint32(old)|sasServices); err != nil {
			return fmt.Errorf("politica do Ctrl+Alt+Del: %w", err)
		}
		// A volta do valor anterior espera um pouco: o pedido ao Winlogon nao e sincrono (conferir no piloto).
		defer time.AfterFunc(2*time.Second, func() {
			k, err := registry.OpenKey(registry.LOCAL_MACHINE, sasPolicyKey, registry.SET_VALUE)
			if err != nil {
				return
			}
			defer k.Close()
			if gerr != nil {
				_ = k.DeleteValue(sasPolicyValue)
			} else {
				_ = k.SetDWordValue(sasPolicyValue, uint32(old))
			}
		})
	}
	// FALSE: a chamada vem de um servico (o remote-helper roda como SYSTEM).
	procSendSAS.Call(0)
	return nil
}
