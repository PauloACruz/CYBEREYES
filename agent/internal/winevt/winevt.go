// Package winevt le o Log de Eventos do Windows (comando eventlog, check eventlog e coleta de logs).
// Fora do Windows todas as funcoes devolvem ErrUnsupported.
package winevt

import (
	"errors"
	"time"
)

// ErrUnsupported indica sistema sem Log de Eventos do Windows.
var ErrUnsupported = errors.New("Log de Eventos disponivel somente no Windows")

// Event e um registro do Log de Eventos.
type Event struct {
	RecordID uint64
	Log      string // System, Application, Security...
	Source   string // provedor
	EventID  int
	// Level: 1 critico, 2 erro, 3 aviso, 4 informacao, 0 informacao (classico); auditoria em Keywords.
	Level int
	// Type no formato do console: INFO, WARNING, ERROR, CRITICAL, AUDIT_SUCCESS, AUDIT_FAILURE.
	Type    string
	Message string
	Time    time.Time
	Host    string
}

// Query devolve os eventos de logName a partir de since (mais recentes primeiro), no maximo max (0 = sem limite).
func Query(logName string, since time.Time, max int) ([]Event, error) {
	return query(logName, since, max)
}

// After devolve os eventos com RecordID maior que after, em ordem crescente, no maximo max.
func After(logName string, after uint64, max int) ([]Event, error) {
	return queryAfter(logName, after, max)
}

// LastRecordID devolve o RecordID mais recente do log (0 se vazio).
func LastRecordID(logName string) (uint64, error) { return lastRecord(logName) }
