package remote

import (
	"log/slog"
	"testing"

	"github.com/pauloacruz/cybereyes/agent/internal/remote/proto"
)

type fakeBoard struct {
	text    string
	writes  []string
	changes chan struct{}
}

func (f *fakeBoard) Read() (string, error) { return f.text, nil }
func (f *fakeBoard) Write(t string) error {
	f.writes = append(f.writes, t)
	f.text = t
	return nil
}
func (f *fakeBoard) Changes() <-chan struct{} { return f.changes }
func (f *fakeBoard) Close() error             { return nil }

func clipFrame(t *testing.T, text string) []byte {
	t.Helper()
	frame, err := proto.JSON(proto.Clipboard, proto.ClipboardBody{Kind: "text", Text: text, Hash: "qualquer"})
	if err != nil {
		t.Fatal(err)
	}
	return frame
}

func newTestSync(toRemote, toLocal bool) (*textSync, *fakeBoard, *[]proto.ClipboardBody) {
	board := &fakeBoard{changes: make(chan struct{}, 1)}
	var sent []proto.ClipboardBody
	c := &textSync{board: board, toRemote: toRemote, toLocal: toLocal, log: slog.New(slog.DiscardHandler),
		send: func(b proto.ClipboardBody) error { sent = append(sent, b); return nil }}
	return c, board, &sent
}

func TestClipboardBothWaysWithoutEcho(t *testing.T) {
	c, board, sent := newTestSync(true, true)

	// Tecnico copia: grava na estacao.
	if err := c.FromViewer(clipFrame(t, "do técnico")); err != nil {
		t.Fatal(err)
	}
	if len(board.writes) != 1 || board.writes[0] != "do técnico" {
		t.Fatalf("gravacoes: %v", board.writes)
	}
	// O aviso de mudanca da propria gravacao nao volta ao visualizador.
	c.changed()
	if len(*sent) != 0 {
		t.Fatalf("eco enviado: %v", *sent)
	}
	// O usuario copia outro texto: vai ao visualizador com o hash SHA-256.
	board.text = "da estação"
	c.changed()
	if len(*sent) != 1 || (*sent)[0].Text != "da estação" || (*sent)[0].Hash != textHash("da estação") || (*sent)[0].Kind != "text" {
		t.Fatalf("enviado: %+v", *sent)
	}
	// O visualizador grava o texto e devolve o mesmo conteudo: nao regrava.
	if err := c.FromViewer(clipFrame(t, "da estação")); err != nil {
		t.Fatal(err)
	}
	if len(board.writes) != 1 {
		t.Fatalf("eco gravado: %v", board.writes)
	}
}

func TestClipboardPolicyBlocksEachWay(t *testing.T) {
	c, board, _ := newTestSync(false, true)
	if err := c.FromViewer(clipFrame(t, "bloqueado")); err != nil || len(board.writes) != 0 {
		t.Fatalf("politica toRemote desligada gravou: %v %v", board.writes, err)
	}
	if got := (noClipboard{}).Features(); got != nil {
		t.Fatalf("sem area de transferencia nao anuncia recurso: %v", got)
	}
	s := &desktopSession{}
	if _, ok := newClipboardSync(t.Context(), s, Policy{}).(noClipboard); !ok {
		t.Fatal("politica com os dois sentidos desligados deveria desligar a sincronizacao")
	}
}

type fakeFileBoard struct {
	fakeBoard
	files   []string
	written []string
}

func (f *fakeFileBoard) ReadFiles() ([]string, error) { return f.files, nil }
func (f *fakeFileBoard) WriteFiles(p []string) error {
	f.written = p
	return nil
}

func TestFilesCopiedAndPasted(t *testing.T) {
	board := &fakeFileBoard{fakeBoard: fakeBoard{changes: make(chan struct{}, 1)}}
	var copied []filesCopiedBody
	c := &textSync{board: board, toLocal: true, filesCopied: true, log: slog.New(slog.DiscardHandler),
		send:      func(proto.ClipboardBody) error { t.Fatal("texto nao deveria ser enviado"); return nil },
		sendFiles: func(b filesCopiedBody) error { copied = append(copied, b); return nil }}
	if f := c.Features(); len(f) != 2 || f[1] != "files-copied" {
		t.Fatalf("recursos: %v", f)
	}
	board.files = []string{t.TempDir()}
	c.changed()
	c.changed() // a mesma lista nao e reenviada
	if len(copied) != 1 || copied[0].Paths[0] != board.files[0] {
		t.Fatalf("FILES_COPIED: %+v", copied)
	}
	if err := c.SetFiles([]string{`C:\Users\maria\Desktop\a.txt`}); err != nil || board.written[0] != `C:\Users\maria\Desktop\a.txt` {
		t.Fatalf("SetFiles: %v %v", err, board.written)
	}
}
