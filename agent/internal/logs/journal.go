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
	"strconv"
	"strings"
	"time"
)

const journalKey = "journal"

// errNoJournal indica sistema sem journalctl (Linux sem systemd).
var errNoJournal = errors.New("journalctl nao encontrado; coleta de logs do Linux indisponivel")

// journalSource le o journald com journalctl -o json a partir do ultimo cursor.
type journalSource struct {
	// bin e o caminho do journalctl (vazio = procurar no PATH).
	bin string
}

// journalPriority converte o nivel minimo no argumento --priority (0 emerg ... 7 debug).
func journalPriority(min string) string {
	switch strings.ToLower(min) {
	case LevelCritical:
		return "2"
	case LevelError:
		return "3"
	case LevelWarning:
		return "4"
	}
	return "6"
}

// journalLevel converte PRIORITY do syslog: 0-2 critical, 3 error, 4 warning, 5-7 info.
func journalLevel(p string) string {
	n, err := strconv.Atoi(strings.TrimSpace(p))
	if err != nil {
		return LevelInfo
	}
	switch {
	case n <= 2:
		return LevelCritical
	case n == 3:
		return LevelError
	case n == 4:
		return LevelWarning
	}
	return LevelInfo
}

func (s *journalSource) path() (string, error) {
	if s.bin != "" {
		return s.bin, nil
	}
	p, err := exec.LookPath("journalctl")
	if err != nil {
		return "", errNoJournal
	}
	return p, nil
}

func (s *journalSource) Read(ctx context.Context, cfg Config, cur map[string]string, emit func(Entry)) (map[string]string, error) {
	bin, err := s.path()
	if err != nil {
		return nil, err
	}
	cursor := cur[journalKey]
	if cursor == "" {
		// Primeira execucao: guarda o cursor da entrada mais recente, sem enviar historico.
		var last string
		_, err := s.stream(ctx, bin, []string{"-o", "json", "-q", "--no-pager", "-n", "1"}, func(e journalEntry) bool {
			last = e.cursor
			return true
		})
		if err != nil {
			return nil, err
		}
		if last == "" {
			return nil, nil
		}
		return map[string]string{journalKey: last}, nil
	}

	args := []string{"-o", "json", "-q", "--no-pager", "--after-cursor=" + cursor, "--priority=" + journalPriority(cfg.MinLevel)}
	last := cursor
	n, err := s.stream(ctx, bin, args, func(e journalEntry) bool {
		if e.cursor != "" {
			last = e.cursor
		}
		emit(e.toEntry(last))
		return true
	})
	if err != nil && n == 0 {
		if strings.Contains(strings.ToLower(err.Error()), "cursor") {
			// Cursor invalido (journal rotacionado ou apagado): recomeca do momento atual.
			return map[string]string{journalKey: ""}, fmt.Errorf("cursor do journald descartado: %w", err)
		}
		return nil, err
	}
	return map[string]string{journalKey: last}, nil
}

// stream executa o journalctl e entrega cada linha JSON, parando em maxScan entradas.
func (s *journalSource) stream(ctx context.Context, bin string, args []string, fn func(journalEntry) bool) (int, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.StdoutPipe()
	if err != nil {
		return 0, err
	}
	if err := cmd.Start(); err != nil {
		return 0, err
	}
	n, stopped, perr := parseJournal(out, maxScan, fn)
	if stopped {
		cancel()
	}
	_, _ = io.Copy(io.Discard, out)
	werr := cmd.Wait()
	if perr != nil {
		return n, perr
	}
	if werr != nil && !stopped && ctx.Err() == nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			return n, fmt.Errorf("journalctl: %w", werr)
		}
		return n, fmt.Errorf("journalctl: %s", firstLine(msg))
	}
	return n, nil
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

// journalEntry e o que interessa de uma linha de journalctl -o json.
type journalEntry struct {
	cursor   string
	realtime string
	priority string
	ident    string
	unit     string
	comm     string
	message  string
	hostname string
}

func (e journalEntry) toEntry(pos string) Entry {
	src := e.ident
	if src == "" {
		src = e.unit
	}
	if src == "" {
		src = e.comm
	}
	if src == "" {
		src = journalKey
	}
	var t time.Time
	if us, err := strconv.ParseInt(e.realtime, 10, 64); err == nil && us > 0 {
		t = time.UnixMicro(us).UTC()
	}
	return Entry{
		Time:    t,
		Level:   journalLevel(e.priority),
		Source:  src,
		Log:     journalKey,
		Message: e.message,
		Host:    e.hostname,
		Key:     journalKey,
		Pos:     pos,
	}
}

// parseJournal le linhas JSON do journalctl. Devolve quantas entradas leu e se parou pelo limite.
func parseJournal(r io.Reader, limit int, fn func(journalEntry) bool) (int, bool, error) {
	br := bufio.NewReaderSize(r, 64*1024)
	n := 0
	for {
		line, err := br.ReadBytes('\n')
		line = bytes.TrimSpace(line)
		if len(line) > 0 && line[0] == '{' {
			var raw map[string]json.RawMessage
			if json.Unmarshal(line, &raw) == nil {
				e := journalEntry{
					cursor:   journalField(raw["__CURSOR"]),
					realtime: journalField(raw["__REALTIME_TIMESTAMP"]),
					priority: journalField(raw["PRIORITY"]),
					ident:    journalField(raw["SYSLOG_IDENTIFIER"]),
					unit:     journalField(raw["_SYSTEMD_UNIT"]),
					comm:     journalField(raw["_COMM"]),
					message:  journalField(raw["MESSAGE"]),
					hostname: journalField(raw["_HOSTNAME"]),
				}
				n++
				if !fn(e) {
					return n, true, nil
				}
				if limit > 0 && n >= limit {
					return n, true, nil
				}
			}
		}
		if err == io.EOF {
			return n, false, nil
		}
		if err != nil {
			return n, false, err
		}
	}
}

// journalField le um campo do journald: texto, lista de bytes (conteudo binario ou UTF-8
// invalido) ou nulo (valor grande demais). Campos repetidos chegam como lista; usa o primeiro.
func journalField(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var b []int
	if json.Unmarshal(raw, &b) == nil {
		buf := make([]byte, 0, len(b))
		for _, v := range b {
			buf = append(buf, byte(v))
		}
		return strings.ToValidUTF8(string(buf), "�")
	}
	var list []json.RawMessage
	if json.Unmarshal(raw, &list) == nil && len(list) > 0 {
		return journalField(list[0])
	}
	return ""
}
