package audio

import (
	"encoding/binary"
	"math"
	"testing"
)

func sine(frames int, freq float64, rate int) []byte {
	out := make([]byte, 0, frames*4)
	for i := 0; i < frames; i++ {
		v := int16(12000 * math.Sin(2*math.Pi*freq*float64(i)/float64(rate)))
		out = binary.LittleEndian.AppendUint16(out, uint16(v))
		out = binary.LittleEndian.AppendUint16(out, uint16(-v))
	}
	return out
}

func TestADPCMRoundTripIsClose(t *testing.T) {
	var enc Encoder
	pcm := sine(FramesPerPacket*3, 440, SampleRate)
	var errSum, n float64
	for p := 0; p < 3; p++ {
		chunk := pcm[p*PacketBytes : (p+1)*PacketBytes]
		body := enc.Encode(chunk, uint32(p))
		if len(body) != 12+2*(4+FramesPerPacket/2) {
			t.Fatalf("tamanho %d", len(body))
		}
		got := Decode(body)
		if len(got) != FramesPerPacket*2 {
			t.Fatalf("amostras %d", len(got))
		}
		for i, v := range got {
			want := int16(binary.LittleEndian.Uint16(chunk[i*2:]))
			errSum += math.Abs(float64(v) - float64(want))
			n++
		}
	}
	if avg := errSum / n; avg > 400 {
		t.Fatalf("erro medio %.0f (seno de amplitude 12000)", avg)
	}
}

func TestPacketIsSelfContained(t *testing.T) {
	var enc Encoder
	pcm := sine(FramesPerPacket*2, 1000, SampleRate)
	_ = enc.Encode(pcm[:PacketBytes], 0) // primeiro quadro perdido
	second := Decode(enc.Encode(pcm[PacketBytes:], 1))
	if second == nil || len(second) != FramesPerPacket*2 {
		t.Fatal("segundo quadro deveria decodificar sozinho")
	}
	if Decode([]byte{9, 2}) != nil {
		t.Fatal("codec desconhecido")
	}
}

func TestSilent(t *testing.T) {
	if !Silent(make([]byte, 100)) || Silent([]byte{0, 0, 1}) {
		t.Fatal("silencio")
	}
}

func TestConverterResamplesAndDownmixes(t *testing.T) {
	// 48 kHz, 6 canais, float32: metade das amostras na saida, so os dois primeiros canais.
	in := SampleFormat{Rate: 48000, Channels: 6, Bits: 32, Float: true}
	c, ok := NewConverter(in)
	if !ok {
		t.Fatal("formato valido recusado")
	}
	var data []byte
	for f := 0; f < 4800; f++ {
		for ch := 0; ch < 6; ch++ {
			v := float32(0.5)
			if ch == 1 {
				v = -0.25
			}
			data = binary.LittleEndian.AppendUint32(data, math.Float32bits(v))
		}
	}
	out := c.Convert(nil, data)
	frames := len(out) / 4
	if frames < 2390 || frames > 2410 {
		t.Fatalf("quadros de saida %d, esperado ~2400", frames)
	}
	l, r := int16(binary.LittleEndian.Uint16(out[400:])), int16(binary.LittleEndian.Uint16(out[402:]))
	if l < 16000 || l > 16500 || r > -8000 || r < -8300 {
		t.Fatalf("amostras L=%d R=%d", l, r)
	}
	// 16 bits mono a 24 kHz: copia para os dois canais.
	m, _ := NewConverter(SampleFormat{Rate: 24000, Channels: 1, Bits: 16})
	mono := m.Convert(nil, []byte{0x00, 0x40, 0x00, 0x40, 0x00, 0x40})
	if len(mono) != 8 || binary.LittleEndian.Uint16(mono) != binary.LittleEndian.Uint16(mono[2:]) {
		t.Fatalf("mono %v", mono)
	}
	if _, ok := NewConverter(SampleFormat{Rate: 48000, Channels: 2, Bits: 8}); ok {
		t.Fatal("8 bits nao e aceito")
	}
}
