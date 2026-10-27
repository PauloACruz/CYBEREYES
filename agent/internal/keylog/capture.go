// capture.go contem o ponto de entrada do subprocesso de captura de teclado, iniciado pelo servico
// na sessao do usuario via CreateProcessAsUser.
package keylog

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"os/signal"
)

// CaptureMain e o ponto de entrada do subprocesso: captura teclas e escreve linhas JSON no stdout.
// O servico encerra o processo cancelando o contexto (matando o pipe).
func CaptureMain(w io.Writer) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	enc := json.NewEncoder(w)
	pub := &stdoutPublisher{enc: enc}
	captureLoop(ctx, "", pub, nil)
	return nil
}

type stdoutPublisher struct {
	enc *json.Encoder
}

func (p *stdoutPublisher) Publish(_ string, body any) error {
	return p.enc.Encode(body)
}
