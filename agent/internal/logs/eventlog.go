package logs

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/pauloacruz/cybereyes/agent/internal/winevt"
)

// eventLogPage e quantos eventos cada chamada a winevt.After devolve.
const eventLogPage = 1000

// defaultWindowsLogs e usado quando o servidor nao manda a lista.
var defaultWindowsLogs = []string{"System", "Application"}

// eventLogAPI abstrai o pacote winevt para os testes.
type eventLogAPI interface {
	After(logName string, after uint64, max int) ([]winevt.Event, error)
	LastRecordID(logName string) (uint64, error)
}

type winevtAPI struct{}

func (winevtAPI) After(logName string, after uint64, max int) ([]winevt.Event, error) {
	return winevt.After(logName, after, max)
}

func (winevtAPI) LastRecordID(logName string) (uint64, error) { return winevt.LastRecordID(logName) }

// eventLogSource le os logs configurados do Windows pelo RecordID, com uma posicao por log.
type eventLogSource struct {
	api eventLogAPI
}

func eventLogKey(name string) string { return "win:" + name }

// eventLogLevel converte o evento: Level 1 critical, 2 error, 3 warning, demais info; falha de
// auditoria vira warning e sucesso de auditoria, info.
func eventLogLevel(ev winevt.Event) string {
	switch strings.ToUpper(ev.Type) {
	case "CRITICAL":
		return LevelCritical
	case "ERROR":
		return LevelError
	case "WARNING", "AUDIT_FAILURE":
		return LevelWarning
	case "INFO", "INFORMATION", "AUDIT_SUCCESS":
		return LevelInfo
	}
	switch ev.Level {
	case 1:
		return LevelCritical
	case 2:
		return LevelError
	case 3:
		return LevelWarning
	}
	return LevelInfo
}

func (s *eventLogSource) Read(ctx context.Context, cfg Config, cur map[string]string, emit func(Entry)) (map[string]string, error) {
	logs := cfg.WindowsLogs
	if len(logs) == 0 {
		logs = defaultWindowsLogs
	}
	next := map[string]string{}
	var errs []error
	seen := map[string]bool{}
	for _, name := range logs {
		name = strings.TrimSpace(name)
		if name == "" || seen[strings.ToLower(name)] {
			continue
		}
		seen[strings.ToLower(name)] = true
		if ctx.Err() != nil {
			return next, ctx.Err()
		}
		key := eventLogKey(name)
		pos, ok := cur[key]
		if !ok || pos == "" {
			// Primeira leitura deste log: comeca do evento mais recente.
			last, err := s.api.LastRecordID(name)
			if err != nil {
				errs = append(errs, fmt.Errorf("log %s: %w", name, err))
				continue
			}
			next[key] = strconv.FormatUint(last, 10)
			continue
		}
		after, err := strconv.ParseUint(pos, 10, 64)
		if err != nil {
			after = 0
		}
		if last, err := s.api.LastRecordID(name); err == nil && last < after {
			// Log limpo: a numeracao recomecou.
			after = 0
		}
		scanned := 0
		var readErr error
		for scanned < maxScan {
			evs, err := s.api.After(name, after, eventLogPage)
			if err != nil {
				readErr = err
				break
			}
			for _, ev := range evs {
				if ev.RecordID <= after {
					continue
				}
				after = ev.RecordID
				emit(eventLogEntry(ev, name, key, after))
			}
			scanned += len(evs)
			if len(evs) < eventLogPage {
				break
			}
		}
		if readErr != nil {
			errs = append(errs, fmt.Errorf("log %s: %w", name, readErr))
			continue
		}
		next[key] = strconv.FormatUint(after, 10)
	}
	return next, errors.Join(errs...)
}

func eventLogEntry(ev winevt.Event, logName, key string, pos uint64) Entry {
	id := int64(ev.EventID)
	log := ev.Log
	if log == "" {
		log = logName
	}
	return Entry{
		Time:    ev.Time,
		Level:   eventLogLevel(ev),
		Source:  ev.Source,
		Log:     log,
		EventID: &id,
		Message: ev.Message,
		Host:    ev.Host,
		Key:     key,
		Pos:     strconv.FormatUint(pos, 10),
	}
}
