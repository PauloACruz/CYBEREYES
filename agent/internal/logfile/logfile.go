// Package logfile grava o log do EYES em arquivo com rotacao por tamanho.
package logfile

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// Writer e um arquivo de log que gira ao passar de maxSize, mantendo keep arquivos antigos.
type Writer struct {
	mu      sync.Mutex
	path    string
	maxSize int64
	keep    int
	f       *os.File
	size    int64
}

// Open abre (ou cria) o arquivo de log.
func Open(path string, maxSize int64, keep int) (*Writer, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	w := &Writer{path: path, maxSize: maxSize, keep: keep}
	if err := w.open(); err != nil {
		return nil, err
	}
	return w, nil
}

func (w *Writer) open() error {
	f, err := os.OpenFile(w.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	w.f, w.size = f, st.Size()
	return nil
}

func (w *Writer) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.f == nil {
		return 0, os.ErrClosed
	}
	if w.size+int64(len(p)) > w.maxSize {
		w.rotate()
	}
	n, err := w.f.Write(p)
	w.size += int64(n)
	return n, err
}

func (w *Writer) rotate() {
	w.f.Close()
	// No Windows, Rename falha se o destino existir: remove antes.
	_ = os.Remove(fmt.Sprintf("%s.%d", w.path, w.keep))
	for i := w.keep - 1; i >= 1; i-- {
		_ = os.Rename(fmt.Sprintf("%s.%d", w.path, i), fmt.Sprintf("%s.%d", w.path, i+1))
	}
	_ = os.Remove(w.path + ".1")
	_ = os.Rename(w.path, w.path+".1")
	if err := w.open(); err != nil {
		w.f = nil
	}
}

// Close fecha o arquivo.
func (w *Writer) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.f == nil {
		return nil
	}
	err := w.f.Close()
	w.f = nil
	return err
}
