package audio

import (
	"encoding/binary"
	"math"
)

// SampleFormat descreve o PCM que a placa de som entrega (formato de mixagem do Windows).
type SampleFormat struct {
	Rate     int
	Channels int
	Bits     int
	Float    bool
}

// Converter leva PCM em qualquer formato aceito para 16 bits estereo a 24 kHz (interpolacao linear; canais alem
// dos dois primeiros sao ignorados, mono e duplicado), guardando a posicao entre blocos.
type Converter struct {
	in   SampleFormat
	pos  float64 // posicao da proxima saida, em amostras de entrada a partir de prev
	prev [2]float64
	have bool
}

// NewConverter valida o formato de entrada.
func NewConverter(in SampleFormat) (*Converter, bool) {
	ok := in.Rate > 0 && in.Channels > 0 && ((in.Float && in.Bits == 32) || (!in.Float && (in.Bits == 16 || in.Bits == 24 || in.Bits == 32)))
	return &Converter{in: in}, ok
}

func (c *Converter) sample(data []byte, frame, ch int) float64 {
	bytes := c.in.Bits / 8
	o := (frame*c.in.Channels + ch) * bytes
	switch {
	case c.in.Float:
		return float64(math.Float32frombits(binary.LittleEndian.Uint32(data[o:])))
	case c.in.Bits == 16:
		return float64(int16(binary.LittleEndian.Uint16(data[o:]))) / 32768
	case c.in.Bits == 24:
		v := int32(data[o]) | int32(data[o+1])<<8 | int32(int8(data[o+2]))<<16
		return float64(v) / 8388608
	default:
		return float64(int32(binary.LittleEndian.Uint32(data[o:]))) / 2147483648
	}
}

// Convert anexa a dst o PCM convertido de data (quadros inteiros do formato de entrada).
func (c *Converter) Convert(dst, data []byte) []byte {
	frames := len(data) / (c.in.Channels * c.in.Bits / 8)
	step := float64(c.in.Rate) / SampleRate
	right := min(1, c.in.Channels-1)
	for f := 0; f < frames; f++ {
		cur := [2]float64{c.sample(data, f, 0), c.sample(data, f, right)}
		if !c.have {
			c.prev, c.have, c.pos = cur, true, 0
			continue
		}
		// Saidas entre prev (posicao 0) e cur (posicao 1).
		for c.pos < 1 {
			for ch := 0; ch < 2; ch++ {
				v := c.prev[ch] + (cur[ch]-c.prev[ch])*c.pos
				dst = binary.LittleEndian.AppendUint16(dst, uint16(toInt16(v)))
			}
			c.pos += step
		}
		c.pos--
		c.prev = cur
	}
	return dst
}

func toInt16(v float64) int16 {
	v *= 32767
	return int16(max(-32768, min(32767, math.Round(v))))
}
