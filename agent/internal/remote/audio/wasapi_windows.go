//go:build windows

package audio

// Captura do som que a maquina toca pelo WASAPI em loopback (Windows Vista ou mais novo), em Go puro: as chamadas
// COM vao direto pela vtable. Posicoes da vtable e GUIDs do SDK do Windows (mmdeviceapi.h, audioclient.h).

import (
	"bufio"
	"fmt"
	"io"
	"runtime"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	ole32                = windows.NewLazySystemDLL("ole32.dll")
	procCoInitializeEx   = ole32.NewProc("CoInitializeEx")
	procCoCreateInstance = ole32.NewProc("CoCreateInstance")
	procCoTaskMemFree    = ole32.NewProc("CoTaskMemFree")

	clsidMMDeviceEnumerator = windows.GUID{Data1: 0xBCDE0395, Data2: 0xE52F, Data3: 0x467C, Data4: [8]byte{0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E}}
	iidIMMDeviceEnumerator  = windows.GUID{Data1: 0xA95664D2, Data2: 0x9614, Data3: 0x4F35, Data4: [8]byte{0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x17, 0xE6}}
	iidIAudioClient         = windows.GUID{Data1: 0x1CB9AD4C, Data2: 0xDBFA, Data3: 0x4C32, Data4: [8]byte{0xB1, 0x78, 0xC2, 0xF5, 0x68, 0xA7, 0x03, 0xB2}}
	iidIAudioCaptureClient  = windows.GUID{Data1: 0xC8ADBD64, Data2: 0xE71E, Data3: 0x48A0, Data4: [8]byte{0xA4, 0xDE, 0x18, 0x5C, 0x39, 0x5C, 0xD3, 0x17}}
	// KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: SubFormat do WAVE_FORMAT_EXTENSIBLE com amostras float.
	subtypeFloat = windows.GUID{Data1: 0x00000003, Data2: 0x0000, Data3: 0x0010, Data4: [8]byte{0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71}}
)

// Posicoes na vtable.
const (
	vRelease = 2

	vEnumGetDefaultAudioEndpoint = 4 // IMMDeviceEnumerator
	vDeviceActivate              = 3 // IMMDevice

	vClientInitialize   = 3 // IAudioClient
	vClientGetMixFormat = 8
	vClientStart        = 10
	vClientStop         = 11
	vClientGetService   = 14

	vCaptureGetBuffer         = 3 // IAudioCaptureClient
	vCaptureReleaseBuffer     = 4
	vCaptureGetNextPacketSize = 5
)

const (
	clsctxAll          = 0x17
	eRender            = 0
	eConsole           = 0
	shareModeShared    = 0
	streamFlagLoopback = 0x00020000
	bufferFlagSilent   = 0x2
	waveFormatPCM      = 1
	waveFormatFloat    = 3
	waveFormatExt      = 0xFFFE
	// hnsBuffer e o tamanho do buffer de captura em unidades de 100 ns (200 ms).
	hnsBuffer = 2_000_000
)

func failed(hr uintptr) bool { return int32(uint32(hr)) < 0 }

//go:uintptrescapes
func comCall(obj unsafe.Pointer, index int, args ...uintptr) uintptr {
	vtbl := *(*unsafe.Pointer)(obj)
	fn := *(*uintptr)(unsafe.Add(vtbl, index*int(unsafe.Sizeof(uintptr(0)))))
	all := make([]uintptr, 0, len(args)+1)
	all = append(all, uintptr(obj))
	all = append(all, args...)
	r, _, _ := syscall.SyscallN(fn, all...)
	return r
}

func release(obj unsafe.Pointer) {
	if obj != nil {
		comCall(obj, vRelease)
	}
}

// int64Args passa um REFERENCE_TIME (int64) por valor: um argumento em 64 bits, dois (baixo, alto) em 32 bits.
func int64Args(v int64) []uintptr {
	if unsafe.Sizeof(uintptr(0)) == 8 {
		return []uintptr{uintptr(v)}
	}
	return []uintptr{uintptr(uint32(v)), uintptr(uint32(uint64(v) >> 32))}
}

type hresult uint32

func (h hresult) Error() string { return fmt.Sprintf("HRESULT 0x%08X", uint32(h)) }

// mixFormat le o WAVEFORMATEX (ou WAVEFORMATEXTENSIBLE) devolvido pelo GetMixFormat.
func mixFormat(p unsafe.Pointer) (SampleFormat, int) {
	b := unsafe.Slice((*byte)(p), 40)
	le16 := func(o int) int { return int(b[o]) | int(b[o+1])<<8 }
	le32 := func(o int) int { return le16(o) | le16(o+2)<<16 }
	tag := le16(0)
	f := SampleFormat{Channels: le16(2), Rate: le32(4), Bits: le16(14)}
	switch tag {
	case waveFormatFloat:
		f.Float = true
	case waveFormatExt:
		if le16(16) >= 22 {
			sub := *(*windows.GUID)(unsafe.Pointer(&b[24]))
			f.Float = sub == subtypeFloat
		}
	}
	return f, le16(12) // nBlockAlign
}

// loopback e a captura aberta da saida de som padrao.
type loopback struct {
	enum, dev, client, capture unsafe.Pointer
	pwfx                       unsafe.Pointer
	conv                       *Converter
	blockAlign                 int
}

func (l *loopback) close() {
	if l.client != nil {
		comCall(l.client, vClientStop)
	}
	release(l.capture)
	release(l.client)
	release(l.dev)
	release(l.enum)
	if l.pwfx != nil {
		procCoTaskMemFree.Call(uintptr(l.pwfx))
	}
}

// openLoopback abre a saida de som padrao em loopback e inicia a captura. Na thread que inicializou o COM.
func openLoopback() (_ *loopback, err error) {
	l := &loopback{}
	defer func() {
		if err != nil {
			l.close()
		}
	}()
	if hr, _, _ := procCoCreateInstance.Call(uintptr(unsafe.Pointer(&clsidMMDeviceEnumerator)), 0, clsctxAll,
		uintptr(unsafe.Pointer(&iidIMMDeviceEnumerator)), uintptr(unsafe.Pointer(&l.enum))); failed(hr) || l.enum == nil {
		return nil, fmt.Errorf("MMDeviceEnumerator: %w", hresult(hr))
	}
	if hr := comCall(l.enum, vEnumGetDefaultAudioEndpoint, eRender, eConsole, uintptr(unsafe.Pointer(&l.dev))); failed(hr) || l.dev == nil {
		return nil, fmt.Errorf("nenhuma saida de som nesta maquina: %w", hresult(hr))
	}
	if hr := comCall(l.dev, vDeviceActivate, uintptr(unsafe.Pointer(&iidIAudioClient)), clsctxAll, 0, uintptr(unsafe.Pointer(&l.client))); failed(hr) || l.client == nil {
		return nil, fmt.Errorf("IAudioClient: %w", hresult(hr))
	}
	if hr := comCall(l.client, vClientGetMixFormat, uintptr(unsafe.Pointer(&l.pwfx))); failed(hr) || l.pwfx == nil {
		return nil, fmt.Errorf("GetMixFormat: %w", hresult(hr))
	}
	format, blockAlign := mixFormat(l.pwfx)
	conv, ok := NewConverter(format)
	if !ok || blockAlign <= 0 {
		return nil, fmt.Errorf("formato de som nao suportado: %+v", format)
	}
	l.conv, l.blockAlign = conv, blockAlign
	args := []uintptr{shareModeShared, streamFlagLoopback}
	args = append(args, int64Args(hnsBuffer)...)
	args = append(args, int64Args(0)...)
	args = append(args, uintptr(l.pwfx), 0)
	if hr := comCall(l.client, vClientInitialize, args...); failed(hr) {
		return nil, fmt.Errorf("IAudioClient.Initialize (loopback): %w", hresult(hr))
	}
	if hr := comCall(l.client, vClientGetService, uintptr(unsafe.Pointer(&iidIAudioCaptureClient)), uintptr(unsafe.Pointer(&l.capture))); failed(hr) || l.capture == nil {
		return nil, fmt.Errorf("IAudioCaptureClient: %w", hresult(hr))
	}
	if hr := comCall(l.client, vClientStart); failed(hr) {
		return nil, fmt.Errorf("IAudioClient.Start: %w", hresult(hr))
	}
	return l, nil
}

// read le os pacotes disponiveis e anexa o PCM convertido a dst.
func (l *loopback) read(dst []byte) ([]byte, error) {
	for {
		var packet uint32
		if hr := comCall(l.capture, vCaptureGetNextPacketSize, uintptr(unsafe.Pointer(&packet))); failed(hr) {
			return dst, fmt.Errorf("GetNextPacketSize: %w", hresult(hr))
		}
		if packet == 0 {
			return dst, nil
		}
		var data unsafe.Pointer
		var frames, flags uint32
		if hr := comCall(l.capture, vCaptureGetBuffer, uintptr(unsafe.Pointer(&data)), uintptr(unsafe.Pointer(&frames)),
			uintptr(unsafe.Pointer(&flags)), 0, 0); failed(hr) {
			return dst, fmt.Errorf("GetBuffer: %w", hresult(hr))
		}
		n := int(frames) * l.blockAlign
		var src []byte
		if flags&bufferFlagSilent != 0 || data == nil {
			src = make([]byte, n)
		} else {
			src = unsafe.Slice((*byte)(data), n)
		}
		dst = l.conv.Convert(dst, src)
		comCall(l.capture, vCaptureReleaseBuffer, uintptr(frames))
	}
}

// Main e o "eyes remote-audio": captura em loopback a saida de som padrao e escreve PCM 16 bits estereo a 24 kHz
// em w ate w falhar (o remote-helper fechou) ou o dispositivo mudar (erro: o remote-helper abre de novo).
func Main(w io.Writer) error {
	runtime.LockOSThread()
	if hr, _, _ := procCoInitializeEx.Call(0, 0 /* COINIT_MULTITHREADED */); failed(hr) {
		return fmt.Errorf("CoInitializeEx: %w", hresult(hr))
	}
	l, err := openLoopback()
	if err != nil {
		return err
	}
	defer l.close()
	out := bufio.NewWriterSize(w, 16<<10)
	var buf []byte
	for {
		time.Sleep(10 * time.Millisecond)
		if buf, err = l.read(buf[:0]); err != nil {
			return err
		}
		if len(buf) == 0 {
			continue
		}
		if _, err := out.Write(buf); err != nil || out.Flush() != nil {
			return nil // o remote-helper fechou a saida: fim normal
		}
	}
}
