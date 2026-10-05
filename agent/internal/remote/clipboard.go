package remote

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"sync"

	"github.com/pauloacruz/cybereyes/agent/internal/remote/clip"
	"github.com/pauloacruz/cybereyes/agent/internal/remote/proto"
)

// clipboardSync sincroniza a area de transferencia da sessao com o visualizador (contrato, secao 6).
type clipboardSync interface {
	// Features devolve os recursos anunciados no HELLO.
	Features() []string
	// FromViewer trata um quadro CLIPBOARD vindo do visualizador.
	FromViewer(frame []byte) error
	Close()
}

// noClipboard e usado quando a politica desliga os dois sentidos ou o sistema nao tem area de transferencia.
type noClipboard struct{}

func (noClipboard) Features() []string            { return nil }
func (noClipboard) FromViewer(frame []byte) error { return nil }
func (noClipboard) Close()                        {}

// openBoard abre a area de transferencia do sistema (trocado nos testes).
var openBoard = clip.Open

func newClipboardSync(ctx context.Context, s *desktopSession, p Policy) clipboardSync {
	if !p.ClipboardToRemote && !p.ClipboardToLocal {
		return noClipboard{}
	}
	board, err := openBoard()
	if err != nil {
		s.log.Info("area de transferencia indisponivel nesta sessao", "erro", err)
		return noClipboard{}
	}
	c := &textSync{board: board, toRemote: p.ClipboardToRemote, toLocal: p.ClipboardToLocal, log: s.log,
		send: func(b proto.ClipboardBody) error { return sendJSON(ctx, s.conn, proto.Clipboard, b) }}
	if c.toLocal {
		go c.watch(ctx)
	}
	return c
}

func textHash(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

// textSync envia o texto copiado na estacao e grava o que vem do visualizador, sem eco: o hash do ultimo conteudo
// trocado (nos dois sentidos) nao e enviado de novo.
type textSync struct {
	board    clip.Board
	toRemote bool
	toLocal  bool
	log      *slog.Logger
	send     func(proto.ClipboardBody) error

	mu   sync.Mutex
	last string
}

func (c *textSync) Features() []string { return []string{"clipboard-text"} }

// seen marca o hash como o ultimo trocado; devolve false se ja era.
func (c *textSync) seen(hash string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if hash == c.last {
		return false
	}
	c.last = hash
	return true
}

func (c *textSync) watch(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case _, ok := <-c.board.Changes():
			if !ok {
				return
			}
			c.changed()
		}
	}
}

// changed le a area de transferencia da estacao e manda o texto ao visualizador quando ele mudou.
func (c *textSync) changed() {
	text, err := c.board.Read()
	if errors.Is(err, clip.ErrTooLarge) {
		c.log.Info("texto copiado acima de 1 MiB nao foi sincronizado")
		return
	}
	if err != nil || text == "" || len(text) > clip.MaxText {
		return
	}
	hash := textHash(text)
	if !c.seen(hash) {
		return
	}
	if err := c.send(proto.ClipboardBody{Kind: "text", Text: text, Hash: hash}); err != nil {
		c.log.Debug("envio da area de transferencia", "erro", err)
	}
}

// FromViewer grava na estacao o texto copiado no computador do tecnico, se a politica permitir.
func (c *textSync) FromViewer(frame []byte) error {
	if !c.toRemote {
		return nil
	}
	var b proto.ClipboardBody
	if err := proto.Decode(frame, &b); err != nil {
		return err
	}
	if b.Kind != "text" {
		return nil
	}
	if len(b.Text) > clip.MaxText {
		return clip.ErrTooLarge
	}
	// O hash e recalculado aqui: o do visualizador so serve para ele.
	if !c.seen(textHash(b.Text)) {
		return nil
	}
	return c.board.Write(b.Text)
}

func (c *textSync) Close() { _ = c.board.Close() }
