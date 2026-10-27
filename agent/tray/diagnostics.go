package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"github.com/pauloacruz/cybereyes/agent/tray/internal/api"
	"github.com/pauloacruz/cybereyes/agent/tray/internal/devices"
)

// eventPeripheralTest abre ou fecha a tela de teste de perifericos na interface.
const eventPeripheralTest = "tray:peripheralTest"

// PeripheralTestEvent e o payload de tray:peripheralTest: o teste aberto pelo tecnico (Active) ou o fim dele.
type PeripheralTestEvent struct {
	Active     bool   `json:"active"`
	TestID     int64  `json:"testId"`
	Section    string `json:"section,omitempty"`
	Technician string `json:"technician,omitempty"`
}

// Devices lista teclados, mouses, touchpads, cameras e aparelhos USB presentes, para a tela de testes.
func (s *TrayService) Devices() devices.Snapshot {
	return devices.List()
}

// KeyboardLayout devolve o layout de teclado ativo e os instalados, para o teste de teclado conferir
// se as teclas batem com o que esta configurado.
func (s *TrayService) KeyboardLayout() devices.Layout {
	return devices.KeyboardLayout()
}

// PeripheralTest devolve o teste aberto, para a interface que carrega depois do pedido.
func (s *TrayService) PeripheralTest() *api.PeripheralTest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.peripheral == nil {
		return nil
	}
	t := *s.peripheral
	return &t
}

// PeripheralTestStart recebe do hub o teste aberto pelo tecnico (realtime.Handler). A janela abre sozinha, na frente das
// outras, na secao pedida: o usuario nao precisa procurar nada. Com o teste ja aberto, so troca a secao.
func (s *TrayService) PeripheralTestStart(t api.PeripheralTest) {
	s.mu.Lock()
	s.peripheral = &t
	s.mu.Unlock()
	log.Printf("realtime: teste de perifericos %d (%s) aberto por %s", t.TestID, t.Section, t.Technician)
	s.emit(eventPeripheralTest, PeripheralTestEvent{Active: true, TestID: t.TestID, Section: t.Section, Technician: t.Technician})
	s.keepOnTop(true)
}

// PeripheralTestStop recebe do hub o fim do teste (encerrado pelo tecnico) ou e chamado quando a API recusa o estado.
func (s *TrayService) PeripheralTestStop(testID int64) {
	s.mu.Lock()
	open := s.peripheral != nil && s.peripheral.TestID == testID
	if open {
		s.peripheral = nil
	}
	s.mu.Unlock()
	if !open {
		return
	}
	log.Printf("realtime: teste de perifericos %d encerrado", testID)
	s.emit(eventPeripheralTest, PeripheralTestEvent{TestID: testID})
	s.keepOnTop(false)
}

// keepOnTop deixa a janela visivel e por cima durante o teste, para o usuario achar a tela que o tecnico pede ao telefone.
func (s *TrayService) keepOnTop(on bool) {
	if s.window == nil {
		return
	}
	if !on {
		s.window.SetAlwaysOnTop(false)
		return
	}
	s.window.Show()
	s.window.Restore()
	s.window.SetAlwaysOnTop(true)
	s.window.Focus()
}

// resumePeripheralTest confere, depois de reconectar ao hub, se o tecnico abriu ou encerrou um teste enquanto o app estava fora.
func (s *TrayService) resumePeripheralTest(ctx context.Context) {
	open, err := s.client.PeripheralTestOpen(ctx)
	if err != nil {
		return
	}
	current := s.PeripheralTest()
	switch {
	case open != nil && (current == nil || current.TestID != open.TestID || current.Section != open.Section):
		s.PeripheralTestStart(*open)
	case open == nil && current != nil:
		s.PeripheralTestStop(current.TestID)
	}
}

// PeripheralTestReport envia o estado da tela de teste ao console. Teste encerrado no servidor fecha a tela aqui.
func (s *TrayService) PeripheralTestReport(ctx context.Context, testID int64, state json.RawMessage) error {
	err := s.client.PeripheralTestState(ctx, testID, state)
	if api.IsStatus(err, http.StatusConflict) || api.IsStatus(err, http.StatusNotFound) {
		s.PeripheralTestStop(testID)
		return nil
	}
	if err != nil {
		return s.friendly(err)
	}
	return nil
}

// PeripheralTestEnd encerra o teste pelo botao do usuario.
func (s *TrayService) PeripheralTestEnd(ctx context.Context, testID int64) error {
	err := s.client.PeripheralTestEnd(ctx, testID)
	s.PeripheralTestStop(testID)
	if err != nil && !api.IsStatus(err, http.StatusConflict) && !api.IsStatus(err, http.StatusNotFound) {
		return s.friendly(err)
	}
	return nil
}
