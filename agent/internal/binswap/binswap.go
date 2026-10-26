// Package binswap troca o executavel do EYES sem deixar a maquina sem ele.
//
// No Windows o executavel em uso nao pode ser sobrescrito, so renomeado: o atual vai para .old e o novo entra no lugar.
// Se o segundo passo falhava (o antivirus examinando o executavel recem-gravado, ou outra troca ao mesmo tempo: o Go
// abre arquivos sem FILE_SHARE_DELETE), nao sobrava executavel nenhum. O servico seguia rodando pela imagem renomeada
// e nao subia mais no boot seguinte: o agente ficava "em atraso" com a maquina ligada.
package binswap

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"time"
)

// Trocados nos testes para simular o arquivo preso por outro processo.
var (
	rename = os.Rename
	tries  = 30
	delay  = time.Second
)

// Swap poe tmp no lugar de dest. Com keepOld (Windows), dest vira dest.old antes; se tmp nao entrar no lugar, o antigo
// volta. dest ausente (sobra de uma troca que falhou em versao anterior) nao impede a troca.
func Swap(ctx context.Context, tmp, dest string, keepOld bool) error {
	if !keepOld {
		return renameRetry(ctx, tmp, dest)
	}
	if _, err := os.Stat(dest); errors.Is(err, fs.ErrNotExist) {
		return renameRetry(ctx, tmp, dest)
	}
	old := dest + ".old"
	_ = os.Remove(old)
	if err := renameRetry(ctx, dest, old); err != nil {
		return err
	}
	if err := renameRetry(ctx, tmp, dest); err != nil {
		if rerr := renameRetry(context.WithoutCancel(ctx), old, dest); rerr != nil {
			return fmt.Errorf("%w; o executavel antigo tambem nao voltou para o lugar: %v", err, rerr)
		}
		return err
	}
	return nil
}

// Ensure recoloca dest a partir de dest.old quando dest sumiu (troca que falhou numa versao anterior). O .old e a imagem
// em execucao ou o ultimo executavel que funcionou; o caminho do proprio processo nao serve, porque no Windows ele
// continua apontando para o nome de quando foi carregado. Devolve true se recolocou.
func Ensure(dest string) (bool, error) {
	if _, err := os.Stat(dest); !errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	old := dest + ".old"
	if _, err := os.Stat(old); err != nil {
		return false, nil
	}
	src, err := os.Open(old)
	if err != nil {
		return false, err
	}
	defer src.Close()
	tmp := dest + ".restore"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return false, err
	}
	if _, err := io.Copy(out, src); err != nil {
		out.Close()
		os.Remove(tmp)
		return false, err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return false, err
	}
	if err := renameRetry(context.Background(), tmp, dest); err != nil {
		os.Remove(tmp)
		return false, err
	}
	return true, nil
}

func renameRetry(ctx context.Context, from, to string) error {
	var err error
	for i := 0; i < tries; i++ {
		if err = rename(from, to); err == nil {
			return nil
		}
		if i == tries-1 {
			break
		}
		select {
		case <-ctx.Done():
			return err
		case <-time.After(delay):
		}
	}
	return err
}
