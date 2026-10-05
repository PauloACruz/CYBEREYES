package checks

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/pauloacruz/cybereyes/agent/internal/winevt"
)

const (
	// maxEventsRead limita os eventos lidos da janela antes do filtro (memoria do agente).
	maxEventsRead = 100000
	// maxEventsSent limita os itens enviados em "log" (contrato 8, item 20).
	maxEventsSent = 5000
	// maxMessageLen limita o tamanho de cada mensagem enviada.
	maxMessageLen = 2048
)

// queryEvents le o Log de Eventos; substituivel nos testes.
var queryEvents = winevt.Query

// eventLogCheck busca os eventos da janela e envia somente os que casam com os filtros.
// A decisao (contains/not_contains e quantidade) e do servidor.
func eventLogCheck(c Check, now time.Time) (map[string]any, error) {
	if c.LogName == "" {
		return nil, fmt.Errorf("check eventlog sem log_name")
	}
	days := min(max(c.SearchLastDays, 1), 365)
	since := now.Add(-time.Duration(days) * 24 * time.Hour)
	events, err := queryEvents(c.LogName, since, maxEventsRead)
	if errors.Is(err, winevt.ErrUnsupported) {
		return nil, fmt.Errorf("%w: %v", errSkip, err)
	}
	if err != nil {
		// Sem leitura do log o resultado seria falso (lista vazia); o check nao e enviado.
		return nil, fmt.Errorf("leitura do log %s: %w", c.LogName, err)
	}
	items := make([]map[string]any, 0)
	for _, ev := range events {
		if !eventMatches(c, ev, since) {
			continue
		}
		items = append(items, eventItem(ev))
		if len(items) >= maxEventsSent {
			break
		}
	}
	return map[string]any{"log": items}, nil
}

// eventMatches aplica os filtros do check: tipo, id (exceto curinga), origem, mensagem e janela.
func eventMatches(c Check, ev winevt.Event, since time.Time) bool {
	if !ev.Time.IsZero() && ev.Time.Before(since) {
		return false
	}
	if !c.EventIDWildcard && c.EventID != 0 && ev.EventID != c.EventID {
		return false
	}
	if c.EventType != "" && !typeMatches(c.EventType, ev) {
		return false
	}
	if c.EventSource != "" && !containsFold(ev.Source, c.EventSource) {
		return false
	}
	if c.EventMessage != "" && !containsFold(ev.Message, c.EventMessage) {
		return false
	}
	return true
}

// normType padroniza o tipo: maiusculas e espacos trocados por "_".
func normType(s string) string {
	return strings.ReplaceAll(strings.ToUpper(strings.TrimSpace(s)), " ", "_")
}

// typeMatches compara o tipo do check com o do evento. ERROR inclui CRITICAL (o console nao tem
// a opcao critico) e INFO aceita INFORMATION.
func typeMatches(want string, ev winevt.Event) bool {
	w, got := normType(want), normType(ev.Type)
	switch w {
	case "INFORMATION":
		w = "INFO"
	case "AUDITSUCCESS":
		w = "AUDIT_SUCCESS"
	case "AUDITFAILURE":
		w = "AUDIT_FAILURE"
	}
	if got == "INFORMATION" {
		got = "INFO"
	}
	if w == "ERROR" && got == "CRITICAL" {
		return true
	}
	return w == got
}

func containsFold(s, sub string) bool {
	return strings.Contains(strings.ToLower(s), strings.ToLower(sub))
}

// eventItem usa o mesmo formato do comando eventlog (contrato 4.3, PROPOSTA de 3.5).
func eventItem(ev winevt.Event) map[string]any {
	msg := ev.Message
	if len(msg) > maxMessageLen {
		cut := maxMessageLen
		for cut > 0 && !utf8.RuneStart(msg[cut]) {
			cut--
		}
		msg = msg[:cut] + "..."
	}
	t := ""
	if !ev.Time.IsZero() {
		t = ev.Time.UTC().Format(time.RFC3339)
	}
	return map[string]any{
		"source":    ev.Source,
		"eventType": ev.Type,
		"eventID":   ev.EventID,
		"message":   msg,
		"time":      t,
	}
}
