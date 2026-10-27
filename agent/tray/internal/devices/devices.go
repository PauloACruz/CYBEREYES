// Package devices lista os perifericos da estacao (teclado, mouse, touchpad, camera e USB) e o layout
// de teclado configurado, para a aba de testes do app de bandeja. Roda na sessao do usuario, sem
// privilegio: no Windows usa a SetupAPI; no Linux le /proc e /sys.
package devices

import (
	"sort"
	"strings"
)

// Tipos de dispositivo que a interface separa por secao.
const (
	KindKeyboard = "keyboard"
	KindPointer  = "pointer"
	KindTouchpad = "touchpad"
	KindCamera   = "camera"
	// KindUSB e o aparelho fisico ligado a uma porta USB (o pendrive, o receptor sem fio, o celular).
	// Teclado, mouse e camera USB aparecem tambem no proprio tipo, com Bus "USB".
	KindUSB = "usb"
)

// Barramentos mostrados ao usuario.
const (
	BusUSB       = "USB"
	BusBluetooth = "Bluetooth"
	BusInternal  = "Interno"
)

// Device e um periferico presente. ID e estavel enquanto o dispositivo fica conectado e serve para
// perceber quem entrou e quem saiu entre duas leituras.
type Device struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"`
	Name         string `json:"name"`
	Model        string `json:"model,omitempty"`
	Manufacturer string `json:"manufacturer,omitempty"`
	Bus          string `json:"bus,omitempty"`
	OK           bool   `json:"ok"`
	Problem      string `json:"problem,omitempty"`
}

// Snapshot e a leitura completa. Supported fica falso no sistema sem implementacao (macOS).
type Snapshot struct {
	Supported bool     `json:"supported"`
	Devices   []Device `json:"devices"`
	Error     string   `json:"error,omitempty"`
}

// Layout e o layout de teclado ativo. ID e o identificador do sistema (KLID no Windows, layout do
// XKB no Linux, como "br" ou "us(intl)"); Name e o nome que o usuario ve nas configuracoes.
type Layout struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Installed []string `json:"installed,omitempty"`
	Error     string   `json:"error,omitempty"`
}

// sortDevices ordena por tipo e nome para a lista nao pular entre leituras.
func sortDevices(list []Device) {
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].Kind != list[j].Kind {
			return list[i].Kind < list[j].Kind
		}
		if !strings.EqualFold(list[i].Name, list[j].Name) {
			return strings.ToLower(list[i].Name) < strings.ToLower(list[j].Name)
		}
		return list[i].ID < list[j].ID
	})
}

// isTouchpadName reconhece touchpads pelo nome que o driver informa.
func isTouchpadName(name string) bool {
	n := strings.ToLower(name)
	for _, s := range []string{"touchpad", "touch pad", "trackpad", "clickpad", "synaptics", "elan"} {
		if strings.Contains(n, s) {
			return true
		}
	}
	return false
}

// problemText traduz o codigo de problema do Gerenciador de Dispositivos do Windows (CM_PROB_*).
func problemText(code uint32) string {
	switch code {
	case 0:
		return ""
	case 1:
		return "Dispositivo não configurado (código 1)"
	case 3:
		return "Driver corrompido ou sem memória (código 3)"
	case 10:
		return "O dispositivo não pode ser iniciado (código 10)"
	case 14:
		return "Reinicie o computador para o dispositivo funcionar (código 14)"
	case 18:
		return "Reinstale o driver (código 18)"
	case 19:
		return "Configuração do registro danificada (código 19)"
	case 21:
		return "O Windows está removendo o dispositivo (código 21)"
	case 22:
		return "Dispositivo desativado (código 22)"
	case 24:
		return "Dispositivo ausente ou sem driver (código 24)"
	case 28:
		return "Driver não instalado (código 28)"
	case 29:
		return "Desativado pelo firmware/BIOS (código 29)"
	case 31:
		return "O driver não carregou (código 31)"
	case 32:
		return "Serviço do driver desativado (código 32)"
	case 39:
		return "Driver ausente ou corrompido (código 39)"
	case 43:
		return "O dispositivo informou falha (código 43)"
	case 45:
		return "Dispositivo desconectado (código 45)"
	case 48:
		return "Driver bloqueado por incompatibilidade (código 48)"
	case 52:
		return "Assinatura do driver não verificada (código 52)"
	}
	return "Problema no dispositivo (código " + itoa(code) + ")"
}

func containsString(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func itoa(n uint32) string {
	if n == 0 {
		return "0"
	}
	var b [10]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
