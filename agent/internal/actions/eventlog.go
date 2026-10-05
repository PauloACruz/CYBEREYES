package actions

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
	"github.com/pauloacruz/cybereyes/agent/internal/winevt"
)

// maxEvents limita a resposta do eventlog aos mais recentes (o NATS aceita ate 64 MiB).
const maxEvents = 5000

// EventItem e um item da resposta do eventlog (atencao: eventType e eventID em camelCase).
type EventItem struct {
	Source    string `json:"source"`
	EventType string `json:"eventType"`
	EventID   int    `json:"eventID"`
	Message   string `json:"message"`
	Time      string `json:"time"`
}

// eventType converte o tipo do winevt no texto que o console reconhece (critico vira ERROR).
func eventType(t string) string {
	switch strings.ToUpper(t) {
	case "CRITICAL", "ERROR":
		return "ERROR"
	case "WARNING":
		return "WARNING"
	case "AUDIT_SUCCESS":
		return "AUDIT_SUCCESS"
	case "AUDIT_FAILURE":
		return "AUDIT_FAILURE"
	}
	return "INFO"
}

func eventItems(evs []winevt.Event) []EventItem {
	out := make([]EventItem, 0, len(evs))
	for _, ev := range evs {
		ts := ""
		if !ev.Time.IsZero() {
			ts = ev.Time.Format(time.RFC3339)
		}
		out = append(out, EventItem{
			Source:    ev.Source,
			EventType: eventType(ev.Type),
			EventID:   ev.EventID,
			Message:   ev.Message,
			Time:      ts,
		})
	}
	return out
}

// eventDays le "days" (str "1".."30"); invalido vira 1.
func eventDays(s string) int {
	d, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || d < 1 {
		return 1
	}
	if d > 30 {
		return 30
	}
	return d
}

// eventlog: { payload: { logname, days }, timeout: 90 } -> lista de { source, eventType, eventID, message, time }.
func (h *handlers) eventlog(ctx context.Context, req rpc.Request) any {
	p := req.Payload()
	logName := strings.TrimSpace(p.Str("logname"))
	if logName == "" {
		logName = "Application"
	}
	since := time.Now().Add(-time.Duration(eventDays(p.Str("days"))) * 24 * time.Hour)
	type out struct {
		evs []winevt.Event
		err error
	}
	r, err := guard(ctx, eventlogLimit, func() out {
		evs, err := winevt.Query(logName, since, maxEvents)
		return out{evs, err}
	})
	if err == nil {
		err = r.err
	}
	if err != nil {
		return errText(fmt.Errorf("falha ao ler o log %s: %w", logName, err))
	}
	return eventItems(r.evs)
}
