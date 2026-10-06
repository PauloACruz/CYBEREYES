//go:build windows

package audio

import (
	"runtime"
	"testing"
	"time"
)

// Abre a captura em loopback da saida de som padrao e le por um instante. Sem placa de som (runner do CI sem
// audio), o erro precisa ser claro, sem derrubar o processo.
func TestLoopbackOpensOrExplains(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	procCoInitializeEx.Call(0, 0)
	l, err := openLoopback()
	if err != nil {
		t.Skipf("sem captura de som nesta maquina: %v", err)
	}
	defer l.close()
	var buf []byte
	for i := 0; i < 20; i++ {
		time.Sleep(10 * time.Millisecond)
		if buf, err = l.read(buf); err != nil {
			t.Fatalf("leitura: %v", err)
		}
	}
	t.Logf("formato %+v, %d bytes convertidos em 200 ms", l.conv.in, len(buf))
	if len(buf)%4 != 0 {
		t.Fatalf("PCM estereo 16 bits com %d bytes", len(buf))
	}
}
