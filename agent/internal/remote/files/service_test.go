package files

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/pauloacruz/cybereyes/agent/internal/remote/proto"
)

// apiSide e a ponta da API no teste: manda pedidos e le respostas, blocos e creditos.
type apiSide struct {
	t    *testing.T
	ctx  context.Context
	conn *websocket.Conn
	id   int
}

func startService(t *testing.T, svc *Service) *apiSide {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		c.SetReadLimit(1 << 20)
		_ = svc.Serve(ctx, c)
	}))
	t.Cleanup(srv.Close)
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	conn.SetReadLimit(1 << 20)
	t.Cleanup(func() { conn.CloseNow() })
	return &apiSide{t: t, ctx: ctx, conn: conn}
}

func (a *apiSide) request(op string, fields map[string]any) {
	a.t.Helper()
	a.id++
	fields["id"], fields["op"] = a.id, op
	frame, _ := proto.JSON(proto.FilesRequest, fields)
	if err := a.conn.Write(a.ctx, websocket.MessageBinary, frame); err != nil {
		a.t.Fatal(err)
	}
}

func (a *apiSide) next() []byte {
	a.t.Helper()
	_, frame, err := a.conn.Read(a.ctx)
	if err != nil {
		a.t.Fatal(err)
	}
	return frame
}

// response le quadros ate a resposta do ultimo pedido; blocos e creditos no caminho vao para os callbacks.
func (a *apiSide) response(onChunk func([]byte), onCredit func(int)) response {
	a.t.Helper()
	for {
		frame := a.next()
		switch frame[0] {
		case proto.FilesResponse:
			var r response
			if err := json.Unmarshal(frame[1:], &r); err != nil {
				a.t.Fatal(err)
			}
			if r.ID == a.id {
				return r
			}
		case proto.FilesChunk:
			if onChunk != nil {
				_, _, data, _ := proto.ParseChunk(frame)
				onChunk(data)
			}
		case proto.FilesCredit:
			var c struct{ Bytes int }
			_ = json.Unmarshal(frame[1:], &c)
			if onCredit != nil {
				onCredit(c.Bytes)
			}
		}
	}
}

func (a *apiSide) call(op string, fields map[string]any) response {
	a.t.Helper()
	a.request(op, fields)
	return a.response(nil, nil)
}

func (a *apiSide) credit(id uint32, n int) {
	frame, _ := proto.JSON(proto.FilesCredit, map[string]any{"transferId": id, "bytes": n})
	_ = a.conn.Write(a.ctx, websocket.MessageBinary, frame)
}

func sum(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func TestUploadResumeAndDownload(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("caminhos do teste no formato Unix")
	}
	dir := t.TempDir()
	svc := &Service{Policy: Policy{Upload: true, Download: true, MaxBytes: 10 << 20}}
	a := startService(t, svc)

	content := bytes.Repeat([]byte("cybereyes-"), 70_000) // 700 KB: varios blocos
	dest := filepath.Join(dir, "relatório.bin")

	// Primeira tentativa: so os primeiros 300 KB chegam.
	r := a.call("upload-begin", map[string]any{"transferId": 7, "path": dest, "size": len(content)})
	if !r.OK {
		t.Fatalf("upload-begin: %+v", r.Error)
	}
	first := 300_000
	for off := 0; off < first; off += ChunkSize {
		end := min(off+ChunkSize, first)
		_ = a.conn.Write(a.ctx, websocket.MessageBinary, proto.ChunkFrame(7, uint64(off), content[off:end]))
	}
	// Espera os creditos da escrita (o agente devolve um por bloco).
	credits := 0
	for credits < 2 {
		frame := a.next()
		if frame[0] == proto.FilesCredit {
			credits++
		}
	}

	// Retomada: novo upload-begin devolve o que ja esta no .partial.
	r = a.call("upload-begin", map[string]any{"transferId": 8, "path": dest, "size": len(content)})
	got := r.Result.(map[string]any)["received"].(float64)
	if int(got) != first {
		t.Fatalf("received = %v, esperado %d", got, first)
	}
	for off := first; off < len(content); off += ChunkSize {
		end := min(off+ChunkSize, len(content))
		_ = a.conn.Write(a.ctx, websocket.MessageBinary, proto.ChunkFrame(8, uint64(off), content[off:end]))
	}
	r = a.call("upload-end", map[string]any{"transferId": 8, "sha256": sum(content)})
	if !r.OK {
		t.Fatalf("upload-end: %+v", r.Error)
	}
	if data, err := os.ReadFile(dest); err != nil || !bytes.Equal(data, content) {
		t.Fatalf("arquivo gravado difere: %v", err)
	}
	if _, err := os.Stat(dest + ".partial"); !os.IsNotExist(err) {
		t.Fatal(".partial ficou para tras")
	}

	// Download com credito: o agente so envia o que a API liberou.
	a.request("download-begin", map[string]any{"transferId": 9, "path": dest})
	a.credit(9, 64<<10)
	var got2 []byte
	r = a.response(func(d []byte) {
		got2 = append(got2, d...)
		a.credit(9, len(d))
	}, nil)
	if !r.OK || !bytes.Equal(got2, content) {
		t.Fatalf("download: ok=%v tamanho=%d erro=%+v", r.OK, len(got2), r.Error)
	}
	res := r.Result.(map[string]any)
	if res["sha256"] != sum(content) || int(res["size"].(float64)) != len(content) {
		t.Fatalf("resultado do download: %v", res)
	}

	// Download a partir de uma posicao (Range).
	a.request("download-begin", map[string]any{"transferId": 10, "path": dest, "offset": 699_990})
	a.credit(10, 1<<20)
	var tail []byte
	r = a.response(func(d []byte) { tail = append(tail, d...) }, nil)
	if !r.OK || !bytes.Equal(tail, content[699_990:]) {
		t.Fatalf("download parcial: %q", tail)
	}
}

func TestUploadHashMismatchAndPolicy(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("caminhos do teste no formato Unix")
	}
	dir := t.TempDir()
	a := startService(t, &Service{Policy: Policy{Upload: true, Download: false, MaxBytes: 100}})
	dest := filepath.Join(dir, "a.txt")

	if r := a.call("upload-begin", map[string]any{"transferId": 1, "path": dest, "size": 101}); r.OK || r.Error.Code != "too-large" {
		t.Fatalf("limite: %+v", r)
	}
	a.call("upload-begin", map[string]any{"transferId": 2, "path": dest, "size": 3})
	_ = a.conn.Write(a.ctx, websocket.MessageBinary, proto.ChunkFrame(2, 0, []byte("abc")))
	if r := a.call("upload-end", map[string]any{"transferId": 2, "sha256": sum([]byte("xyz"))}); r.OK || r.Error.Code != "hash-mismatch" {
		t.Fatalf("hash: %+v", r)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Fatal("arquivo com hash errado nao pode ficar no destino")
	}
	if r := a.call("download-begin", map[string]any{"transferId": 3, "path": dest}); r.OK || r.Error.Code != "denied" {
		t.Fatalf("politica de download: %+v", r)
	}
	if r := a.call("list", map[string]any{"path": dir + "/../etc"}); r.OK || r.Error.Code != "invalid-path" {
		t.Fatalf("caminho com ..: %+v", r)
	}
}

func TestBrowseAndZip(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("caminhos do teste no formato Unix")
	}
	dir := t.TempDir()
	a := startService(t, &Service{Policy: Policy{Upload: true, Download: true}})
	if r := a.call("mkdir", map[string]any{"path": dir + "/Pasta"}); !r.OK {
		t.Fatalf("mkdir: %+v", r.Error)
	}
	_ = os.WriteFile(filepath.Join(dir, "Pasta", "um.txt"), []byte("1"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "b.txt"), []byte("bb"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, ".oculto"), nil, 0o644)

	r := a.call("list", map[string]any{"path": dir})
	var list []Entry
	data, _ := json.Marshal(r.Result)
	_ = json.Unmarshal(data, &list)
	if len(list) != 3 || list[0].Name != "Pasta" || list[0].Kind != "dir" || !list[1].Hidden || list[2].Name != "b.txt" || list[2].Size != 2 {
		t.Fatalf("lista: %+v", list)
	}
	if r := a.call("rename", map[string]any{"from": dir + "/b.txt", "to": dir + "/Pasta/um.txt"}); r.OK || r.Error.Code != "exists" {
		t.Fatalf("renomear por cima: %+v", r)
	}
	if r := a.call("rename", map[string]any{"from": dir + "/b.txt", "to": dir + "/c.txt"}); !r.OK {
		t.Fatalf("renomear: %+v", r.Error)
	}

	a.request("download-begin", map[string]any{"transferId": 4, "path": dir + "/Pasta", "zip": true})
	a.credit(4, 1<<20)
	var z []byte
	r = a.response(func(d []byte) { z = append(z, d...) }, nil)
	if !r.OK {
		t.Fatalf("zip: %+v", r.Error)
	}
	zr, err := zip.NewReader(bytes.NewReader(z), int64(len(z)))
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	if strings.Join(names, ",") != "Pasta/,Pasta/um.txt" {
		t.Fatalf("conteudo do zip: %v", names)
	}

	if r := a.call("delete", map[string]any{"path": dir + "/Pasta"}); r.OK {
		t.Fatal("apagar pasta sem recursive deveria falhar")
	}
	if r := a.call("delete", map[string]any{"path": dir + "/Pasta", "recursive": true}); !r.OK {
		t.Fatalf("apagar recursivo: %+v", r.Error)
	}
	if r := a.call("clipboard-files", map[string]any{"transferIds": []int{1}}); r.OK || r.Error.Code != "unsupported" {
		t.Fatalf("clipboard-files sem suporte: %+v", r)
	}
}
