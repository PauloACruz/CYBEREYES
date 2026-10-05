package files

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/coder/websocket"

	"github.com/pauloacruz/cybereyes/agent/internal/remote/proto"
)

// Limites do canal (contrato, secoes 7.1, 7.2 e 7.4).
const (
	ChunkSize   = 256 << 10
	UploadGrant = 4 << 20
	MaxList     = 5000
)

// Policy e a parte da politica que vale para arquivos.
type Policy struct {
	Upload   bool
	Download bool
	MaxBytes int64
}

// Codigos de erro do contrato (secao 7.2).
var (
	ErrDenied       = errors.New("operacao nao permitida")
	ErrTooLarge     = errors.New("arquivo acima do limite")
	ErrHashMismatch = errors.New("o arquivo recebido nao confere com o enviado")
	ErrBusy         = errors.New("transferencia ja em andamento")
	ErrUnsupported  = errors.New("operacao nao suportada neste sistema")
)

// Entry e o FileEntryDto do contrato.
type Entry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Kind       string `json:"kind"`
	Size       int64  `json:"size"`
	ModifiedAt string `json:"modifiedAt"`
	Hidden     bool   `json:"hidden"`
}

type request struct {
	ID          int      `json:"id"`
	Op          string   `json:"op"`
	Path        string   `json:"path"`
	Paths       []string `json:"paths"`
	From        string   `json:"from"`
	To          string   `json:"to"`
	Recursive   bool     `json:"recursive"`
	TransferID  uint32   `json:"transferId"`
	TransferIDs []uint32 `json:"transferIds"`
	Size        int64    `json:"size"`
	Overwrite   bool     `json:"overwrite"`
	Restart     bool     `json:"restart"`
	SHA256      string   `json:"sha256"`
	Offset      int64    `json:"offset"`
	Zip         bool     `json:"zip"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type response struct {
	ID     int        `json:"id"`
	OK     bool       `json:"ok"`
	Result any        `json:"result"`
	Error  *errorBody `json:"error,omitempty"`
}

type upload struct {
	path    string
	partial string
	size    int64
	written int64
	file    *os.File
	failed  error
}

type download struct {
	credit chan int
	cancel context.CancelFunc
}

// Service atende uma conexao do canal files.
type Service struct {
	GOOS   string
	User   User
	Policy Policy
	Log    *slog.Logger
	// ClipboardFiles poe os arquivos na area de transferencia da sessao (remote-helper); nil quando nao suportado.
	ClipboardFiles func(paths []string) error

	conn      *websocket.Conn
	mu        sync.Mutex
	uploads   map[uint32]*upload
	downloads map[uint32]*download
	finished  map[uint32]string
	// early guarda credito que chegou antes do download se registrar (a API concede logo apos o pedido).
	early map[uint32]int
}

// Serve atende o canal ate a conexao fechar ou ctx terminar.
func (s *Service) Serve(ctx context.Context, conn *websocket.Conn) error {
	if s.GOOS == "" {
		s.GOOS = runtime.GOOS
	}
	if s.Log == nil {
		s.Log = slog.New(slog.DiscardHandler)
	}
	s.conn = conn
	s.uploads, s.downloads, s.finished, s.early = map[uint32]*upload{}, map[uint32]*download{}, map[uint32]string{}, map[uint32]int{}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	defer s.cleanup()
	for {
		_, frame, err := conn.Read(ctx)
		if err != nil {
			return err
		}
		if len(frame) == 0 {
			continue
		}
		switch frame[0] {
		case proto.FilesRequest:
			var req request
			if err := json.Unmarshal(frame[1:], &req); err != nil {
				continue
			}
			go s.handle(ctx, req)
		case proto.FilesChunk:
			s.chunk(ctx, frame)
		case proto.FilesCredit:
			var c struct {
				TransferID uint32 `json:"transferId"`
				Bytes      int    `json:"bytes"`
			}
			if json.Unmarshal(frame[1:], &c) == nil {
				s.mu.Lock()
				d := s.downloads[c.TransferID]
				if d == nil && len(s.early) < 64 {
					s.early[c.TransferID] += c.Bytes
				}
				s.mu.Unlock()
				if d != nil {
					select {
					case d.credit <- c.Bytes:
					default:
					}
				}
			}
		case proto.FilesCancel:
			var c struct {
				TransferID uint32 `json:"transferId"`
			}
			if json.Unmarshal(frame[1:], &c) == nil {
				s.cancelTransfer(c.TransferID)
			}
		}
	}
}

func (s *Service) cleanup() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, u := range s.uploads {
		if u.file != nil {
			u.file.Close()
		}
	}
	for _, d := range s.downloads {
		d.cancel()
	}
}

func (s *Service) cancelTransfer(id uint32) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if d := s.downloads[id]; d != nil {
		d.cancel()
		delete(s.downloads, id)
	}
	if u := s.uploads[id]; u != nil {
		if u.file != nil {
			u.file.Close()
		}
		delete(s.uploads, id)
	}
}

func (s *Service) send(ctx context.Context, frame []byte) error {
	return s.conn.Write(ctx, websocket.MessageBinary, frame)
}

func (s *Service) sendJSON(ctx context.Context, t byte, v any) error {
	frame, err := proto.JSON(t, v)
	if err != nil {
		return err
	}
	return s.send(ctx, frame)
}

func (s *Service) respond(ctx context.Context, id int, result any, err error) {
	r := response{ID: id, OK: err == nil, Result: result}
	if err != nil {
		r.Result = nil
		r.Error = &errorBody{Code: Code(err), Message: err.Error()}
	}
	if serr := s.sendJSON(ctx, proto.FilesResponse, r); serr != nil {
		s.Log.Debug("resposta do canal files", "erro", serr)
	}
}

// Code traduz o erro para o codigo do contrato.
func Code(err error) string {
	switch {
	case errors.Is(err, ErrInvalidPath):
		return "invalid-path"
	case errors.Is(err, fs.ErrNotExist), errors.Is(err, ErrNoUser):
		return "not-found"
	case errors.Is(err, fs.ErrExist):
		return "exists"
	case errors.Is(err, fs.ErrPermission), errors.Is(err, ErrDenied):
		return "denied"
	case errors.Is(err, ErrTooLarge):
		return "too-large"
	case errors.Is(err, ErrHashMismatch):
		return "hash-mismatch"
	case errors.Is(err, ErrBusy):
		return "busy"
	case isNoSpace(err):
		return "no-space"
	case errors.Is(err, ErrUnsupported):
		return "unsupported"
	}
	return "io"
}

func isNoSpace(err error) bool {
	var errno syscall.Errno
	if errors.As(err, &errno) {
		// ENOSPC no Unix; ERROR_DISK_FULL (112) e ERROR_HANDLE_DISK_FULL (39) no Windows.
		return errno == syscall.ENOSPC || (runtime.GOOS == "windows" && (errno == 112 || errno == 39))
	}
	return false
}

func (s *Service) check(p string) (string, error) { return CheckPath(s.GOOS, p) }

func (s *Service) handle(ctx context.Context, req request) {
	var (
		result any
		err    error
	)
	switch req.Op {
	case "home":
		result, err = Dirs(s.User)
	case "list":
		result, err = s.list(req.Path)
	case "stat":
		result, err = s.stat(req.Path)
	case "mkdir":
		err = s.mkdir(req.Path)
	case "rename":
		err = s.rename(req.From, req.To)
	case "delete":
		err = s.remove(req.Path, req.Recursive)
	case "upload-begin":
		result, err = s.uploadBegin(ctx, req)
		if err == nil {
			s.respond(ctx, req.ID, result, nil)
			_ = s.sendJSON(ctx, proto.FilesCredit, map[string]any{"transferId": req.TransferID, "bytes": UploadGrant})
			return
		}
	case "upload-end":
		result, err = s.uploadEnd(req)
	case "download-begin":
		// A resposta sai no fim do envio, com o tamanho e o SHA-256 do que foi enviado (contrato, secao 7.5).
		result, err = s.download(ctx, req)
	case "clipboard-files":
		err = s.clipboardFiles(req.TransferIDs)
	default:
		err = fmt.Errorf("%w: %s", ErrUnsupported, req.Op)
	}
	s.respond(ctx, req.ID, result, err)
}

func (s *Service) entry(p string, info fs.FileInfo) Entry {
	kind := "file"
	switch {
	case info.Mode()&fs.ModeSymlink != 0:
		kind = "link"
	case info.IsDir():
		kind = "dir"
	}
	return Entry{Name: info.Name(), Path: p, Kind: kind, Size: info.Size(), ModifiedAt: info.ModTime().UTC().Format(time.RFC3339), Hidden: hidden(info.Name(), info)}
}

func (s *Service) list(dir string) ([]Entry, error) {
	dir, err := s.check(dir)
	if err != nil {
		return nil, err
	}
	items, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, min(len(items), MaxList))
	for _, it := range items {
		if len(out) >= MaxList {
			break
		}
		info, err := it.Info()
		if err != nil {
			continue
		}
		p, err := Join(s.GOOS, dir, it.Name())
		if err != nil {
			continue
		}
		out = append(out, s.entry(p, info))
	}
	sort.SliceStable(out, func(i, j int) bool {
		if (out[i].Kind == "dir") != (out[j].Kind == "dir") {
			return out[i].Kind == "dir"
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

func (s *Service) stat(p string) (Entry, error) {
	p, err := s.check(p)
	if err != nil {
		return Entry{}, err
	}
	info, err := os.Lstat(p)
	if err != nil {
		return Entry{}, err
	}
	return s.entry(p, info), nil
}

func (s *Service) mkdir(p string) error {
	p, err := s.check(p)
	if err != nil {
		return err
	}
	if err := os.Mkdir(p, 0o755); err != nil {
		return err
	}
	giveTo(s.User, p)
	return nil
}

func (s *Service) rename(from, to string) error {
	from, err := s.check(from)
	if err != nil {
		return err
	}
	to, err = s.check(to)
	if err != nil {
		return err
	}
	if _, err := os.Lstat(to); err == nil {
		return fs.ErrExist
	}
	return os.Rename(from, to)
}

// remove apaga o caminho; o recursivo nao segue links simbolicos (apaga o link, nao o destino).
func (s *Service) remove(p string, recursive bool) error {
	p, err := s.check(p)
	if err != nil {
		return err
	}
	if _, err := os.Lstat(p); err != nil {
		return err
	}
	if recursive {
		return os.RemoveAll(p)
	}
	return os.Remove(p)
}

func (s *Service) uploadBegin(_ context.Context, req request) (any, error) {
	if !s.Policy.Upload {
		return nil, ErrDenied
	}
	if req.Size < 0 || (s.Policy.MaxBytes > 0 && req.Size > s.Policy.MaxBytes) {
		return nil, ErrTooLarge
	}
	dest, err := s.check(req.Path)
	if err != nil {
		return nil, err
	}
	if info, err := os.Stat(dest); err == nil {
		if info.IsDir() || !req.Overwrite {
			return nil, fs.ErrExist
		}
	}
	s.mu.Lock()
	if old := s.uploads[req.TransferID]; old != nil && old.file != nil {
		old.file.Close()
	}
	s.mu.Unlock()
	partial := dest + ".partial"
	f, err := os.OpenFile(partial, os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	giveTo(s.User, partial)
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	received := info.Size()
	if received > req.Size || req.Restart {
		// Restos de outro arquivo com o mesmo nome, ou a API sem o hash do inicio: recomeca.
		if err := f.Truncate(0); err != nil {
			f.Close()
			return nil, err
		}
		received = 0
	}
	s.mu.Lock()
	s.uploads[req.TransferID] = &upload{path: dest, partial: partial, size: req.Size, written: received, file: f}
	s.mu.Unlock()
	return map[string]any{"received": received}, nil
}

// chunk grava um bloco do envio na posicao esperada e devolve o credito ao remetente.
func (s *Service) chunk(ctx context.Context, frame []byte) {
	id, offset, data, err := proto.ParseChunk(frame)
	if err != nil {
		return
	}
	s.mu.Lock()
	u := s.uploads[id]
	s.mu.Unlock()
	if u == nil || u.failed != nil {
		return
	}
	switch {
	case int64(offset) != u.written:
		u.failed = fmt.Errorf("bloco fora de ordem: esperado %d, veio %d", u.written, offset)
	case u.written+int64(len(data)) > u.size:
		u.failed = ErrTooLarge
	default:
		if _, err := u.file.WriteAt(data, int64(offset)); err != nil {
			u.failed = err
		} else {
			u.written += int64(len(data))
		}
	}
	if u.failed != nil {
		s.Log.Warn("envio de arquivo interrompido", "transferencia", id, "erro", u.failed)
		_ = s.sendJSON(ctx, proto.FilesCancel, map[string]any{"transferId": id})
		return
	}
	_ = s.sendJSON(ctx, proto.FilesCredit, map[string]any{"transferId": id, "bytes": len(data)})
}

func fileHash(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// uploadEnd confere tamanho e SHA-256 do que esta no disco com o calculado pela API e so entao troca o .partial
// pelo destino.
func (s *Service) uploadEnd(req request) (any, error) {
	s.mu.Lock()
	u := s.uploads[req.TransferID]
	delete(s.uploads, req.TransferID)
	s.mu.Unlock()
	if u == nil {
		return nil, fs.ErrNotExist
	}
	if err := u.file.Close(); err != nil {
		return nil, err
	}
	if u.failed != nil {
		return nil, u.failed
	}
	if u.written != u.size {
		return nil, fmt.Errorf("%w: recebidos %d de %d bytes", ErrHashMismatch, u.written, u.size)
	}
	sum, err := fileHash(u.partial)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(sum, req.SHA256) {
		_ = os.Remove(u.partial)
		return nil, ErrHashMismatch
	}
	if err := os.Rename(u.partial, u.path); err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.finished[req.TransferID] = u.path
	s.mu.Unlock()
	return map[string]any{"sha256": sum, "path": u.path}, nil
}

// creditWriter envia blocos de ate ChunkSize respeitando o credito concedido pela API.
type creditWriter struct {
	ctx    context.Context
	s      *Service
	id     uint32
	offset uint64
	credit int
	in     chan int
	hash   io.Writer
}

func (w *creditWriter) Write(p []byte) (int, error) {
	written := 0
	for len(p) > 0 {
		for w.credit <= 0 {
			select {
			case <-w.ctx.Done():
				return written, w.ctx.Err()
			case c := <-w.in:
				w.credit += c
			}
		}
		n := min(len(p), ChunkSize, w.credit)
		if err := w.s.send(w.ctx, proto.ChunkFrame(w.id, w.offset, p[:n])); err != nil {
			return written, err
		}
		_, _ = w.hash.Write(p[:n])
		w.offset += uint64(n)
		w.credit -= n
		written += n
		p = p[n:]
	}
	return written, nil
}

func (s *Service) download(ctx context.Context, req request) (any, error) {
	if !s.Policy.Download {
		return nil, ErrDenied
	}
	paths := req.Paths
	if len(paths) == 0 {
		paths = []string{req.Path}
	}
	for i, p := range paths {
		c, err := s.check(p)
		if err != nil {
			return nil, err
		}
		paths[i] = c
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	d := &download{credit: make(chan int, 64), cancel: cancel}
	s.mu.Lock()
	if s.downloads[req.TransferID] != nil {
		s.mu.Unlock()
		return nil, ErrBusy
	}
	s.downloads[req.TransferID] = d
	early := s.early[req.TransferID]
	delete(s.early, req.TransferID)
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.downloads, req.TransferID)
		s.mu.Unlock()
	}()
	h := sha256.New()
	w := &creditWriter{ctx: ctx, s: s, id: req.TransferID, offset: uint64(max(0, req.Offset)), credit: early, in: d.credit, hash: h}
	var err error
	if req.Zip || len(paths) > 1 {
		err = writeZip(w, paths)
	} else {
		err = copyFile(w, paths[0], req.Offset)
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"size": int64(w.offset) - max(0, req.Offset), "sha256": hex.EncodeToString(h.Sum(nil))}, nil
}

func copyFile(w io.Writer, p string, offset int64) error {
	f, err := os.Open(p)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("%w: pasta so pode ser baixada como zip", ErrInvalidPath)
	}
	if offset > 0 {
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			return err
		}
	}
	_, err = io.CopyBuffer(w, f, make([]byte, ChunkSize))
	return err
}

// writeZip gera o zip durante o envio: cada caminho entra com o proprio nome; pastas entram com o conteudo.
// Links simbolicos nao sao seguidos.
func writeZip(w io.Writer, paths []string) error {
	zw := zip.NewWriter(w)
	for _, root := range paths {
		base := filepath.Dir(root)
		err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.Type()&fs.ModeSymlink != 0 {
				return nil
			}
			rel, err := filepath.Rel(base, p)
			if err != nil {
				return err
			}
			name := filepath.ToSlash(rel)
			info, err := d.Info()
			if err != nil {
				return err
			}
			if d.IsDir() {
				_, err := zw.CreateHeader(&zip.FileHeader{Name: name + "/", Modified: info.ModTime()})
				return err
			}
			hdr, err := zip.FileInfoHeader(info)
			if err != nil {
				return err
			}
			hdr.Name, hdr.Method = name, zip.Deflate
			out, err := zw.CreateHeader(hdr)
			if err != nil {
				return err
			}
			f, err := os.Open(p)
			if err != nil {
				return err
			}
			_, err = io.Copy(out, f)
			f.Close()
			return err
		})
		if err != nil {
			return err
		}
	}
	return zw.Close()
}

// clipboardFiles poe na area de transferencia da sessao os arquivos ja recebidos (Windows, contrato 7.6).
func (s *Service) clipboardFiles(ids []uint32) error {
	if s.ClipboardFiles == nil {
		return ErrUnsupported
	}
	s.mu.Lock()
	paths := make([]string, 0, len(ids))
	for _, id := range ids {
		if p, ok := s.finished[id]; ok {
			paths = append(paths, p)
		}
	}
	s.mu.Unlock()
	if len(paths) == 0 {
		return fs.ErrNotExist
	}
	return s.ClipboardFiles(paths)
}
