package logs

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const unifiedKey = "unified"

// Formatos de hora do log unificado: saida ndjson e argumento --start (hora local).
const (
	unifiedTimeLayout  = "2006-01-02 15:04:05.000000-0700"
	unifiedStartLayout = "2006-01-02 15:04:05"
	// unifiedLag e a folga para eventos que o logd grava com atraso.
	unifiedLag = 2 * time.Second
)

// unifiedSource le o log unificado do macOS com log show --style ndjson. A posicao e a hora do
// ultimo evento lido; como --start tem resolucao de segundos, eventos ate essa hora sao ignorados.
type unifiedSource struct {
	bin string
	now func() time.Time
}

// unifiedPredicate escolhe os tipos conforme o nivel minimo: error e fault, e default com info.
func unifiedPredicate(min string) string {
	if rank(min) == 0 {
		return "messageType == default OR messageType == error OR messageType == fault"
	}
	return "messageType == error OR messageType == fault"
}

// unifiedLevel converte messageType: Fault critical, Error error, demais info.
func unifiedLevel(t string) string {
	switch strings.ToLower(t) {
	case "fault":
		return LevelCritical
	case "error":
		return LevelError
	}
	return LevelInfo
}

func (s *unifiedSource) clock() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

func (s *unifiedSource) Read(ctx context.Context, cfg Config, cur map[string]string, emit func(Entry)) (map[string]string, error) {
	start := s.clock()
	since, err := time.Parse(time.RFC3339Nano, cur[unifiedKey])
	if cur[unifiedKey] == "" || err != nil {
		// Primeira execucao: comeca do momento atual.
		return map[string]string{unifiedKey: start.UTC().Format(time.RFC3339Nano)}, nil
	}
	bin := s.bin
	if bin == "" {
		if bin, err = exec.LookPath("log"); err != nil {
			bin = "/usr/bin/log"
		}
	}
	args := []string{"show", "--style", "ndjson", "--start", since.Local().Format(unifiedStartLayout),
		"--predicate", unifiedPredicate(cfg.MinLevel)}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("log show: %w", err)
	}
	last, n, stopped, perr := parseUnified(out, since, maxScan, emit)
	if stopped {
		cancel()
	}
	_, _ = io.Copy(io.Discard, out)
	werr := cmd.Wait()
	if perr != nil {
		return nil, perr
	}
	if werr != nil && !stopped && n == 0 {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			return nil, fmt.Errorf("log show: %w", werr)
		}
		return nil, errors.New("log show: " + firstLine(msg))
	}
	pos := since
	if last.After(pos) {
		pos = last
	}
	// Sem parar pelo limite, tudo ate o inicio do ciclo (menos a folga) ja foi lido.
	if !stopped {
		if edge := start.Add(-unifiedLag); edge.After(pos) {
			pos = edge
		}
	}
	return map[string]string{unifiedKey: pos.UTC().Format(time.RFC3339Nano)}, nil
}

// unifiedEvent e o que interessa de uma linha ndjson do log show.
type unifiedEvent struct {
	Timestamp        string `json:"timestamp"`
	MessageType      string `json:"messageType"`
	EventType        string `json:"eventType"`
	EventMessage     string `json:"eventMessage"`
	Subsystem        string `json:"subsystem"`
	Category         string `json:"category"`
	ProcessImagePath string `json:"processImagePath"`
	SenderImagePath  string `json:"senderImagePath"`
}

// parseUnified le a saida ndjson, emitindo os eventos posteriores a since. Devolve a hora do
// ultimo evento emitido, quantos leu e se parou pelo limite.
func parseUnified(r io.Reader, since time.Time, limit int, emit func(Entry)) (time.Time, int, bool, error) {
	br := bufio.NewReaderSize(r, 64*1024)
	var last time.Time
	n := 0
	for {
		line, err := br.ReadBytes('\n')
		line = bytes.TrimSpace(line)
		if len(line) > 0 && line[0] == '{' {
			var ev unifiedEvent
			if json.Unmarshal(line, &ev) == nil && (ev.EventType == "" || ev.EventType == "logEvent") {
				t, terr := time.Parse(unifiedTimeLayout, ev.Timestamp)
				if terr == nil && t.After(since) {
					n++
					if t.After(last) {
						last = t
					}
					emit(Entry{
						Time:    t.UTC(),
						Level:   unifiedLevel(ev.MessageType),
						Source:  ev.source(),
						Log:     unifiedKey,
						Message: ev.EventMessage,
						Key:     unifiedKey,
						Pos:     t.UTC().Format(time.RFC3339Nano),
					})
					if limit > 0 && n >= limit {
						return last, n, true, nil
					}
				}
			}
		}
		if err == io.EOF {
			return last, n, false, nil
		}
		if err != nil {
			return last, n, false, err
		}
	}
}

// source usa o subsistema (com a categoria) ou, sem ele, o nome do processo.
func (e unifiedEvent) source() string {
	if e.Subsystem != "" {
		if e.Category != "" {
			return e.Subsystem + ":" + e.Category
		}
		return e.Subsystem
	}
	if e.ProcessImagePath != "" {
		return filepath.Base(e.ProcessImagePath)
	}
	if e.SenderImagePath != "" {
		return filepath.Base(e.SenderImagePath)
	}
	return unifiedKey
}
