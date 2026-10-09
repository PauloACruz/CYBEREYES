package remote

import (
	"context"
	"encoding/binary"
	"io"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/remote/audio"
	"github.com/pauloacruz/cybereyes/agent/internal/remote/proto"
)

// fakeSound entrega um bloco de silencio e depois blocos com som, ate ser fechado.
type fakeSound struct {
	n      int
	closed atomic.Bool
	done   chan struct{}
}

func (f *fakeSound) Read(b []byte) (int, error) {
	if f.closed.Load() {
		return 0, io.EOF
	}
	if f.n > 0 {
		time.Sleep(5 * time.Millisecond)
	}
	f.n++
	for i := range b {
		b[i] = 0
	}
	if f.n > audio.PacketBytes { // primeiro bloco inteiro de silencio
		for i := 0; i+1 < len(b); i += 2 {
			binary.LittleEndian.PutUint16(b[i:], uint16(1000+i))
		}
	}
	f.n += len(b) - 1
	return len(b), nil
}

func (f *fakeSound) Close() error {
	if f.closed.CompareAndSwap(false, true) {
		close(f.done)
	}
	return nil
}

func TestAudioTurnsOnAndOffWithSettings(t *testing.T) {
	src := &fakeSound{done: make(chan struct{})}
	oldOpen, oldAvail := audioOpen, audioAvailable
	audioOpen = func(context.Context) (audio.Stream, error) { return src, nil }
	audioAvailable = func() bool { return true }
	t.Cleanup(func() { audioOpen, audioAvailable = oldOpen, oldAvail })

	v, s := startFrameLoop(t, newFakeScreen(64, 64), proto.SettingsBody{Quality: 60, Scale: 1, MaxFPS: 5})
	s.applySettings(proto.SettingsBody{Quality: 60, Scale: 1, MaxFPS: 5, Audio: true})
	select {
	case msg := <-v.audios:
		pcm := audio.Decode(msg[1:])
		if len(pcm) != audio.FramesPerPacket*audio.Channels {
			t.Fatalf("quadro AUDIO com %d amostras", len(pcm))
		}
		if binary.BigEndian.Uint32(msg[7:]) != 1 {
			t.Fatal("o bloco de silencio nao deveria ter sido enviado (sequencia comeca em 1)")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("nenhum quadro AUDIO")
	}
	s.applySettings(proto.SettingsBody{Quality: 60, Scale: 1, MaxFPS: 5, Audio: false})
	select {
	case <-src.done:
	case <-time.After(3 * time.Second):
		t.Fatal("desligar o som deveria fechar a captura")
	}
}
