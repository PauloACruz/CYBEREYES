// Package proto define os quadros do relay do acesso remoto (docs/remoto/contrato-remoto.md, secoes 4 a 7):
// 1 byte de tipo seguido de JSON ou de um corpo binario, com inteiros em big-endian.
package proto

import (
	"encoding/binary"
	"encoding/json"
	"errors"
)

// Versao do protocolo enviada no AUTH e no HELLO.
const Version = 1

// Tipos de quadro.
const (
	Auth     byte = 0x01
	AuthOK   byte = 0x02
	Paired   byte = 0x03
	PeerGone byte = 0x04

	Hello       byte = 0x10
	Tile        byte = 0x11
	FrameEnd    byte = 0x12
	Cursor      byte = 0x13
	Clipboard   byte = 0x14
	Displays    byte = 0x15
	Consent     byte = 0x16
	FilesCopied byte = 0x17
	Bye         byte = 0x18
	Error       byte = 0x19

	Settings byte = 0x20
	Key      byte = 0x21
	Text     byte = 0x22
	Mouse    byte = 0x23
	Wheel    byte = 0x24
	Refresh  byte = 0x25
	CAD      byte = 0x26
	Ack      byte = 0x27

	FilesRequest  byte = 0x40
	FilesResponse byte = 0x41
	FilesChunk    byte = 0x42
	FilesCredit   byte = 0x43
	FilesCancel   byte = 0x44

	// RdpData leva os bytes do RDP do agente para o visualizador no canal rdp (contrato, secao 5.4).
	RdpData byte = 0x50
)

// Codigos de fechamento do relay.
const (
	CloseAuth        = 4401
	CloseForbidden   = 4403
	ClosePeerTimeout = 4408
	CloseDuplicate   = 4409
	CloseEnded       = 4410
	CloseTooLarge    = 4413
	CloseRate        = 4429
)

// ErrShort indica quadro menor que o cabecalho do tipo.
var ErrShort = errors.New("quadro curto demais")

// JSON monta um quadro de tipo t com corpo JSON.
func JSON(t byte, v any) ([]byte, error) {
	body, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return append([]byte{t}, body...), nil
}

// Decode le o corpo JSON de um quadro.
func Decode(frame []byte, v any) error {
	if len(frame) < 2 {
		return ErrShort
	}
	return json.Unmarshal(frame[1:], v)
}

// AuthBody e o corpo do AUTH.
type AuthBody struct {
	Token string `json:"token"`
	Role  string `json:"role"`
	Proto int    `json:"proto"`
}

// HelloBody e o corpo do HELLO.
type HelloBody struct {
	Proto    int       `json:"proto"`
	OS       string    `json:"os"`
	Displays []Display `json:"displays"`
	Active   int       `json:"active"`
	Features []string  `json:"features"`
	User     *string   `json:"user"`
}

// Display e um monitor, em pixels fisicos.
type Display struct {
	ID      int     `json:"id"`
	Name    string  `json:"name"`
	X       int     `json:"x"`
	Y       int     `json:"y"`
	W       int     `json:"w"`
	H       int     `json:"h"`
	Scale   float64 `json:"scale"`
	Primary bool    `json:"primary"`
}

// SettingsBody e o corpo do SETTINGS. Cursor verdadeiro: o visualizador desenha o ponteiro a partir dos quadros
// CURSOR e o agente nao o desenha mais na imagem (contrato, secao 5.1).
type SettingsBody struct {
	Quality int     `json:"quality"`
	Scale   float64 `json:"scale"`
	MaxFPS  int     `json:"maxFps"`
	Display int     `json:"display"`
	Cursor  bool    `json:"cursor,omitempty"`
}

// CursorBody e o corpo do CURSOR: posicao do ponto ativo no quadro (ja na escala), id do desenho e, so na primeira
// vez de cada id, o PNG em base64 com o ponto ativo em pixels do desenho.
type CursorBody struct {
	Visible bool    `json:"visible"`
	X       int     `json:"x"`
	Y       int     `json:"y"`
	ID      uint32  `json:"id"`
	HotX    int     `json:"hotX"`
	HotY    int     `json:"hotY"`
	PNG     *string `json:"png"`
}

// KeyBody e o corpo do KEY.
type KeyBody struct {
	Code string `json:"code"`
	Down bool   `json:"down"`
}

// TextBody e o corpo do TEXT.
type TextBody struct {
	Text string `json:"text"`
}

// MouseBody e o corpo do MOUSE.
type MouseBody struct {
	X       int `json:"x"`
	Y       int `json:"y"`
	Buttons int `json:"buttons"`
}

// WheelBody e o corpo do WHEEL.
type WheelBody struct {
	DX int `json:"dx"`
	DY int `json:"dy"`
}

// ClipboardBody e o corpo do CLIPBOARD.
type ClipboardBody struct {
	Kind string `json:"kind"`
	Text string `json:"text,omitempty"`
	Hash string `json:"hash"`
}

// ConsentBody e o corpo do CONSENT.
type ConsentBody struct {
	State string `json:"state"`
}

// ReasonBody e o corpo do BYE e do PEER_GONE.
type ReasonBody struct {
	Reason string `json:"reason"`
}

// ErrorBody e o corpo do ERROR.
type ErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// TileFrame monta um TILE: u32 frame, u16 x, u16 y, u16 w, u16 h e o JPEG.
func TileFrame(frame uint32, x, y, w, h int, jpeg []byte) []byte {
	b := make([]byte, 13, 13+len(jpeg))
	b[0] = Tile
	binary.BigEndian.PutUint32(b[1:], frame)
	binary.BigEndian.PutUint16(b[5:], uint16(x))
	binary.BigEndian.PutUint16(b[7:], uint16(y))
	binary.BigEndian.PutUint16(b[9:], uint16(w))
	binary.BigEndian.PutUint16(b[11:], uint16(h))
	return append(b, jpeg...)
}

// FrameEndFrame monta um FRAME_END: u32 frame, u16 tiles, u16 largura, u16 altura.
func FrameEndFrame(frame uint32, tiles, width, height int) []byte {
	b := make([]byte, 11)
	b[0] = FrameEnd
	binary.BigEndian.PutUint32(b[1:], frame)
	binary.BigEndian.PutUint16(b[5:], uint16(tiles))
	binary.BigEndian.PutUint16(b[7:], uint16(width))
	binary.BigEndian.PutUint16(b[9:], uint16(height))
	return b
}

// ParseAck le um ACK: u32 frame e u32 milissegundos de recepcao.
func ParseAck(frame []byte) (uint32, uint32, error) {
	if len(frame) < 9 {
		return 0, 0, ErrShort
	}
	return binary.BigEndian.Uint32(frame[1:]), binary.BigEndian.Uint32(frame[5:]), nil
}

// ChunkFrame monta um CHUNK do canal files: u32 transferencia, u64 posicao e os dados.
func ChunkFrame(transfer uint32, offset uint64, data []byte) []byte {
	b := make([]byte, 13, 13+len(data))
	b[0] = FilesChunk
	binary.BigEndian.PutUint32(b[1:], transfer)
	binary.BigEndian.PutUint64(b[5:], offset)
	return append(b, data...)
}

// ParseChunk le um CHUNK.
func ParseChunk(frame []byte) (uint32, uint64, []byte, error) {
	if len(frame) < 13 {
		return 0, 0, nil, ErrShort
	}
	return binary.BigEndian.Uint32(frame[1:]), binary.BigEndian.Uint64(frame[5:]), frame[13:], nil
}
