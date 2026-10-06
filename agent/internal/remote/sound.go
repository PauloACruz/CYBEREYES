package remote

import (
	"context"
	"io"
	"time"

	"github.com/coder/websocket"

	"github.com/pauloacruz/cybereyes/agent/internal/remote/audio"
	"github.com/pauloacruz/cybereyes/agent/internal/remote/proto"
)

// audioOpen e audioAvailable abrem e conferem a captura do som (trocados nos testes).
var (
	audioOpen      = audio.Open
	audioAvailable = audio.Available
)

// setAudio liga ou desliga a captura do som conforme o settings.audio. Chamado com s.mu travado.
func (s *desktopSession) setAudio(on bool) {
	if on == (s.audioCancel != nil) {
		return
	}
	if !on {
		s.audioCancel()
		s.audioCancel = nil
		return
	}
	if s.ctx == nil || !audioAvailable() {
		return
	}
	ctx, cancel := context.WithCancel(s.ctx)
	s.audioCancel = cancel
	go s.audioLoop(ctx)
}

// audioLoop le o PCM da fonte de som, comprime em IMA ADPCM e envia quadros AUDIO de 40 ms. Blocos de silencio nao
// sao enviados. Se a fonte cair (troca de dispositivo de som), abre de novo; depois de tres falhas seguidas, avisa o
// visualizador e para.
func (s *desktopSession) audioLoop(ctx context.Context) {
	var enc audio.Encoder
	var seq uint32
	failures := 0
	buf := make([]byte, audio.PacketBytes)
	for ctx.Err() == nil {
		stream, err := audioOpen(ctx)
		if err == nil {
			for {
				if _, err = io.ReadFull(stream, buf); err != nil {
					break
				}
				failures = 0
				if audio.Silent(buf) {
					continue
				}
				seq++
				if werr := s.conn.Write(ctx, websocket.MessageBinary, proto.AudioFrame(enc.Encode(buf, seq))); werr != nil {
					_ = stream.Close()
					return
				}
			}
			_ = stream.Close()
		}
		if ctx.Err() != nil {
			return
		}
		failures++
		if failures >= 3 {
			msg := "O som desta máquina não pôde ser capturado"
			if err != nil {
				msg += ": " + err.Error()
			}
			s.log.Warn("som da maquina indisponivel", "erro", err)
			_ = sendJSON(ctx, s.conn, proto.Error, proto.ErrorBody{Code: "audio", Message: msg})
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}
