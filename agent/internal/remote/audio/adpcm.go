// Package audio leva o som da maquina acessada ao visualizador (contrato, secao 5.1, AUDIO): a captura roda num
// processo a parte (no Windows o "eyes remote-audio" com WASAPI em loopback; no Linux o parec do PulseAudio ou do
// PipeWire), que entrega PCM 16 bits estereo a 24 kHz; o remote-helper comprime em IMA ADPCM e envia.
package audio

import "encoding/binary"

// Formato entregue pelas fontes e enviado ao visualizador.
const (
	SampleRate = 24000
	Channels   = 2
	// PacketMillis e a duracao de cada quadro AUDIO.
	PacketMillis = 40
	// FramesPerPacket e o numero de amostras por canal em cada quadro.
	FramesPerPacket = SampleRate * PacketMillis / 1000
	// PacketBytes e o tamanho do PCM de entrada de um quadro (16 bits, intercalado).
	PacketBytes = FramesPerPacket * Channels * 2
	// CodecIMAADPCM identifica o codec no quadro AUDIO.
	CodecIMAADPCM = 1
)

var imaSteps = [89]int32{
	7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107,
	118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876,
	963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
	5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086,
	29794, 32767,
}

var imaIndex = [16]int32{-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8}

type imaState struct {
	predictor int32
	index     int32
}

func (s *imaState) encode(sample int32) byte {
	step := imaSteps[s.index]
	diff := sample - s.predictor
	var nibble byte
	if diff < 0 {
		nibble = 8
		diff = -diff
	}
	delta := step >> 3
	if diff >= step {
		nibble |= 4
		diff -= step
		delta += step
	}
	step >>= 1
	if diff >= step {
		nibble |= 2
		diff -= step
		delta += step
	}
	step >>= 1
	if diff >= step {
		nibble |= 1
		delta += step
	}
	s.apply(nibble, delta)
	return nibble
}

func (s *imaState) decode(nibble byte) int16 {
	step := imaSteps[s.index]
	delta := step >> 3
	if nibble&4 != 0 {
		delta += step
	}
	if nibble&2 != 0 {
		delta += step >> 1
	}
	if nibble&1 != 0 {
		delta += step >> 2
	}
	s.apply(nibble, delta)
	return int16(s.predictor)
}

func (s *imaState) apply(nibble byte, delta int32) {
	if nibble&8 != 0 {
		s.predictor -= delta
	} else {
		s.predictor += delta
	}
	s.predictor = max(-32768, min(32767, s.predictor))
	s.index = max(0, min(88, s.index+imaIndex[nibble]))
}

// Encoder comprime blocos de PCM estereo em IMA ADPCM, mantendo o estado entre blocos.
type Encoder struct {
	state [Channels]imaState
}

// Encode devolve o corpo do quadro AUDIO (sem o byte de tipo) para pcm (16 bits little-endian, intercalado,
// numero par de amostras por canal): codec, canais, taxa, sequencia, amostras por canal e, por canal, o estado
// inicial (preditor e indice) seguido das amostras em 4 bits (primeira no nibble baixo).
func (e *Encoder) Encode(pcm []byte, seq uint32) []byte {
	frames := len(pcm) / (2 * Channels)
	frames -= frames % 2
	per := 4 + frames/2
	out := make([]byte, 12+Channels*per)
	out[0] = CodecIMAADPCM
	out[1] = Channels
	binary.BigEndian.PutUint32(out[2:], SampleRate)
	binary.BigEndian.PutUint32(out[6:], seq)
	binary.BigEndian.PutUint16(out[10:], uint16(frames))
	for c := 0; c < Channels; c++ {
		block := out[12+c*per : 12+(c+1)*per]
		st := &e.state[c]
		binary.BigEndian.PutUint16(block[0:], uint16(int16(st.predictor)))
		block[2] = byte(st.index)
		for i := 0; i < frames; i++ {
			sample := int32(int16(binary.LittleEndian.Uint16(pcm[(i*Channels+c)*2:])))
			n := st.encode(sample)
			if i%2 == 0 {
				block[4+i/2] = n
			} else {
				block[4+i/2] |= n << 4
			}
		}
	}
	return out
}

// Decode reconstroi o PCM intercalado de um corpo de quadro AUDIO (usado nos testes; o visualizador faz o mesmo).
func Decode(body []byte) []int16 {
	if len(body) < 12 || body[0] != CodecIMAADPCM {
		return nil
	}
	ch := int(body[1])
	frames := int(binary.BigEndian.Uint16(body[10:]))
	per := 4 + frames/2
	if ch == 0 || len(body) < 12+ch*per {
		return nil
	}
	out := make([]int16, frames*ch)
	for c := 0; c < ch; c++ {
		block := body[12+c*per:]
		st := imaState{predictor: int32(int16(binary.BigEndian.Uint16(block))), index: int32(block[2])}
		for i := 0; i < frames; i++ {
			b := block[4+i/2]
			if i%2 == 1 {
				b >>= 4
			}
			out[i*ch+c] = st.decode(b & 0x0f)
		}
	}
	return out
}

// Silent informa se o bloco PCM e todo zero (nada tocando: o quadro nao e enviado).
func Silent(pcm []byte) bool {
	for _, b := range pcm {
		if b != 0 {
			return false
		}
	}
	return true
}
