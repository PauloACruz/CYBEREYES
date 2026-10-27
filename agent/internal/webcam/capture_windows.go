//go:build windows

// Captura da webcam no Windows por Media Foundation em Go puro (nada de CGo).
//
// O caminho resumido:
//  1. CoInitializeEx(MTA) + MFStartup (uma vez por processo).
//  2. MFEnumDeviceSources com atributo "video capture" devolve IMFActivate[], a primeira camera e
//     ativada como IMFMediaSource.
//  3. MFCreateSourceReaderFromMediaSource cria um IMFSourceReader com o atributo
//     MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING = TRUE: o Media Foundation adiciona os conversores
//     necessarios para entregar RGB32 na resolucao pedida.
//  4. Para cada quadro: ReadSample -> ConvertToContiguousBuffer -> Lock devolve os pixels BGRA.
//     Convertemos para image.RGBA (troca B e R) e codificamos em JPEG com image/jpeg.
//
// As chamadas COM sao feitas por syscall.SyscallN com os vtbl das interfaces. Toda a thread da
// camera fica presa a uma OS thread (LockOSThread) porque Media Foundation e sensivel a thread.
package webcam

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"runtime"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	mfplat      = windows.NewLazySystemDLL("mfplat.dll")
	mf          = windows.NewLazySystemDLL("mf.dll")
	mfreadwrite = windows.NewLazySystemDLL("mfreadwrite.dll")
	ole32       = windows.NewLazySystemDLL("ole32.dll")

	procMFStartup                           = mfplat.NewProc("MFStartup")
	procMFCreateAttributes                  = mfplat.NewProc("MFCreateAttributes")
	procMFCreateMediaType                   = mfplat.NewProc("MFCreateMediaType")
	procMFEnumDeviceSources                 = mf.NewProc("MFEnumDeviceSources")
	procMFCreateSourceReaderFromMediaSource = mfreadwrite.NewProc("MFCreateSourceReaderFromMediaSource")
	procCoInitializeEx                      = ole32.NewProc("CoInitializeEx")
	procCoTaskMemFree                       = ole32.NewProc("CoTaskMemFree")
)

const (
	mfVersion                                   = 0x00020070 // (MF_API_VERSION<<16) | MF_SDK_VERSION do SDK 2
	coinitMultithreaded                         = 0x0
	mfSourceReaderFirstVideoStream       uint32 = 0xFFFFFFFC
	mfSourceReaderfError                 uint32 = 0x1
	mfSourceReaderfEndOfStream           uint32 = 0x2
	mfSourceReaderfCurrentMediaTypeChang uint32 = 0x10
	interlaceModeProgressive             uint32 = 2
)

// GUIDs do Media Foundation que precisamos.
var (
	guidDevSourceAttributeSourceType       = guid("c60ac5fe-252a-478f-a0ef-bc8fa5f7ca93")
	guidDevSourceAttributeSourceTypeVidcap = guid("8ac3587a-4ae7-42d8-99e0-0a6013eef90f")
	guidIidIMFMediaSource                  = guid("279a808d-aec7-40c8-9c6b-a6b492c78a66")
	guidMtMajorType                        = guid("48eba18e-f8c9-4687-bf11-0a74c9f96a5f")
	guidMediaTypeVideo                     = guid("73646976-0000-0010-8000-00aa00389b71")
	guidMtSubtype                          = guid("f7e34c9a-42e8-4714-b74b-cb29d72c35e5")
	guidVideoFormatRGB32                   = guid("00000016-0000-0010-8000-00aa00389b71")
	guidMtFrameSize                        = guid("1652c33d-d6b2-4012-b834-72030849a37d")
	guidMtInterlaceMode                    = guid("c0bb9089-0b8f-4cf6-9c0d-00e73b739bc2")
	guidSourceReaderEnableVideoProcessing  = guid("fb394f3d-ccf1-42ee-bbb3-f9b845d5681d")
)

// guid converte "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" em windows.GUID.
func guid(s string) windows.GUID {
	g, err := windows.GUIDFromString("{" + s + "}")
	if err != nil {
		panic("webcam: guid invalida " + s + ": " + err.Error())
	}
	return g
}

// mfOnce inicia Media Foundation uma unica vez por processo.
var mfOnce = sync.OnceValue(func() error {
	// CoInitializeEx devolve S_OK (0) ou S_FALSE (1); S_FALSE significa que ja estava iniciado nesta
	// thread com o mesmo modelo. Qualquer outro valor com bit alto e erro.
	hr, _, _ := procCoInitializeEx.Call(0, uintptr(coinitMultithreaded))
	if hr&0x80000000 != 0 {
		return fmt.Errorf("CoInitializeEx: 0x%x", hr)
	}
	hr, _, _ = procMFStartup.Call(uintptr(mfVersion), uintptr(0))
	if hr != 0 {
		return fmt.Errorf("MFStartup: 0x%x", hr)
	}
	return nil
})

// Vtbl das interfaces usadas.
type iunknownVtbl struct {
	QueryInterface uintptr
	AddRef         uintptr
	Release        uintptr
}

type iunknown struct {
	vtbl *iunknownVtbl
}

func (u *iunknown) release() uintptr {
	if u == nil {
		return 0
	}
	r, _, _ := syscall.SyscallN(u.vtbl.Release, uintptr(unsafe.Pointer(u)))
	return r
}

type imfAttributesVtbl struct {
	iunknownVtbl
	GetItem            uintptr
	GetItemType        uintptr
	CompareItem        uintptr
	Compare            uintptr
	GetUINT32          uintptr
	GetUINT64          uintptr
	GetDouble          uintptr
	GetGUID            uintptr
	GetStringLength    uintptr
	GetString          uintptr
	GetAllocatedString uintptr
	GetBlobSize        uintptr
	GetBlob            uintptr
	GetAllocatedBlob   uintptr
	GetUnknown         uintptr
	SetItem            uintptr
	DeleteItem         uintptr
	DeleteAllItems     uintptr
	SetUINT32          uintptr
	SetUINT64          uintptr
	SetDouble          uintptr
	SetGUID            uintptr
	SetString          uintptr
	SetBlob            uintptr
	SetUnknown         uintptr
	LockStore          uintptr
	UnlockStore        uintptr
	GetCount           uintptr
	GetItemByIndex     uintptr
	CopyAllItems       uintptr
}

type imfAttributes struct {
	vtbl *imfAttributesVtbl
}

func (a *imfAttributes) setGUID(key, value *windows.GUID) error {
	hr, _, _ := syscall.SyscallN(a.vtbl.SetGUID, uintptr(unsafe.Pointer(a)),
		uintptr(unsafe.Pointer(key)), uintptr(unsafe.Pointer(value)))
	if hr != 0 {
		return fmt.Errorf("IMFAttributes::SetGUID: 0x%x", hr)
	}
	return nil
}

func (a *imfAttributes) setUINT64(key *windows.GUID, value uint64) error {
	hr, _, _ := syscall.SyscallN(a.vtbl.SetUINT64, uintptr(unsafe.Pointer(a)),
		uintptr(unsafe.Pointer(key)), uintptr(value))
	if hr != 0 {
		return fmt.Errorf("IMFAttributes::SetUINT64: 0x%x", hr)
	}
	return nil
}

func (a *imfAttributes) setUINT32(key *windows.GUID, value uint32) error {
	hr, _, _ := syscall.SyscallN(a.vtbl.SetUINT32, uintptr(unsafe.Pointer(a)),
		uintptr(unsafe.Pointer(key)), uintptr(value))
	if hr != 0 {
		return fmt.Errorf("IMFAttributes::SetUINT32: 0x%x", hr)
	}
	return nil
}

func (a *imfAttributes) release() uintptr {
	if a == nil {
		return 0
	}
	r, _, _ := syscall.SyscallN(a.vtbl.Release, uintptr(unsafe.Pointer(a)))
	return r
}

// IMFActivate herda de IMFAttributes.
type imfActivateVtbl struct {
	imfAttributesVtbl
	ActivateObject uintptr
	ShutdownObject uintptr
	DetachObject   uintptr
}

type imfActivate struct {
	vtbl *imfActivateVtbl
}

func (a *imfActivate) activateObject(iid *windows.GUID) (uintptr, error) {
	var obj uintptr
	hr, _, _ := syscall.SyscallN(a.vtbl.ActivateObject, uintptr(unsafe.Pointer(a)),
		uintptr(unsafe.Pointer(iid)), uintptr(unsafe.Pointer(&obj)))
	if hr != 0 {
		return 0, fmt.Errorf("IMFActivate::ActivateObject: 0x%x", hr)
	}
	return obj, nil
}

func (a *imfActivate) shutdownObject() {
	syscall.SyscallN(a.vtbl.ShutdownObject, uintptr(unsafe.Pointer(a)))
}

func (a *imfActivate) release() uintptr {
	if a == nil {
		return 0
	}
	r, _, _ := syscall.SyscallN(a.vtbl.Release, uintptr(unsafe.Pointer(a)))
	return r
}

// IMFMediaSource (herda de IMFMediaEventGenerator, mas so usamos Release/Shutdown).
type imfMediaSourceVtbl struct {
	iunknownVtbl
	// IMFMediaEventGenerator
	GetEvent      uintptr
	BeginGetEvent uintptr
	EndGetEvent   uintptr
	QueueEvent    uintptr
	// IMFMediaSource
	GetCharacteristics           uintptr
	CreatePresentationDescriptor uintptr
	Start                        uintptr
	Stop                         uintptr
	Pause                        uintptr
	Shutdown                     uintptr
}

type imfMediaSource struct {
	vtbl *imfMediaSourceVtbl
}

func (s *imfMediaSource) shutdown() {
	if s == nil {
		return
	}
	syscall.SyscallN(s.vtbl.Shutdown, uintptr(unsafe.Pointer(s)))
}

func (s *imfMediaSource) release() uintptr {
	if s == nil {
		return 0
	}
	r, _, _ := syscall.SyscallN(s.vtbl.Release, uintptr(unsafe.Pointer(s)))
	return r
}

// IMFSourceReader.
type imfSourceReaderVtbl struct {
	iunknownVtbl
	GetStreamSelection       uintptr
	SetStreamSelection       uintptr
	GetNativeMediaType       uintptr
	GetCurrentMediaType      uintptr
	SetCurrentMediaType      uintptr
	SetCurrentPosition       uintptr
	ReadSample               uintptr
	Flush                    uintptr
	GetServiceForStream      uintptr
	GetPresentationAttribute uintptr
}

type imfSourceReader struct {
	vtbl *imfSourceReaderVtbl
}

func (r *imfSourceReader) setCurrentMediaType(mt *imfMediaType) error {
	hr, _, _ := syscall.SyscallN(r.vtbl.SetCurrentMediaType, uintptr(unsafe.Pointer(r)),
		uintptr(mfSourceReaderFirstVideoStream), 0, uintptr(unsafe.Pointer(mt)))
	if hr != 0 {
		return fmt.Errorf("IMFSourceReader::SetCurrentMediaType: 0x%x", hr)
	}
	return nil
}

func (r *imfSourceReader) readSample() (*imfSample, uint32, error) {
	var streamIdx, flags uint32
	var timestamp int64
	var sample *imfSample
	hr, _, _ := syscall.SyscallN(r.vtbl.ReadSample, uintptr(unsafe.Pointer(r)),
		uintptr(mfSourceReaderFirstVideoStream), 0,
		uintptr(unsafe.Pointer(&streamIdx)), uintptr(unsafe.Pointer(&flags)),
		uintptr(unsafe.Pointer(&timestamp)), uintptr(unsafe.Pointer(&sample)))
	if hr != 0 {
		return nil, flags, fmt.Errorf("IMFSourceReader::ReadSample: 0x%x", hr)
	}
	return sample, flags, nil
}

func (r *imfSourceReader) release() uintptr {
	if r == nil {
		return 0
	}
	ret, _, _ := syscall.SyscallN(r.vtbl.Release, uintptr(unsafe.Pointer(r)))
	return ret
}

// IMFMediaType herda de IMFAttributes.
type imfMediaType struct {
	vtbl *imfAttributesVtbl
	// GetMajorType, IsCompressedFormat, IsEqual, GetRepresentation, FreeRepresentation ficam depois
	// no vtbl mas nao sao usados aqui.
}

func (m *imfMediaType) attrs() *imfAttributes { return (*imfAttributes)(unsafe.Pointer(m)) }

func (m *imfMediaType) release() uintptr {
	if m == nil {
		return 0
	}
	r, _, _ := syscall.SyscallN(m.vtbl.Release, uintptr(unsafe.Pointer(m)))
	return r
}

// IMFSample (herda de IMFAttributes).
type imfSampleVtbl struct {
	imfAttributesVtbl
	GetSampleFlags            uintptr
	SetSampleFlags            uintptr
	GetSampleTime             uintptr
	SetSampleTime             uintptr
	GetSampleDuration         uintptr
	SetSampleDuration         uintptr
	GetBufferCount            uintptr
	GetBufferByIndex          uintptr
	ConvertToContiguousBuffer uintptr
	AddBuffer                 uintptr
	RemoveBufferByIndex       uintptr
	RemoveAllBuffers          uintptr
	GetTotalLength            uintptr
	CopyToBuffer              uintptr
}

type imfSample struct {
	vtbl *imfSampleVtbl
}

func (s *imfSample) convertToContiguousBuffer() (*imfMediaBuffer, error) {
	var buf *imfMediaBuffer
	hr, _, _ := syscall.SyscallN(s.vtbl.ConvertToContiguousBuffer, uintptr(unsafe.Pointer(s)),
		uintptr(unsafe.Pointer(&buf)))
	if hr != 0 {
		return nil, fmt.Errorf("IMFSample::ConvertToContiguousBuffer: 0x%x", hr)
	}
	return buf, nil
}

func (s *imfSample) release() uintptr {
	if s == nil {
		return 0
	}
	r, _, _ := syscall.SyscallN(s.vtbl.Release, uintptr(unsafe.Pointer(s)))
	return r
}

// IMFMediaBuffer.
type imfMediaBufferVtbl struct {
	iunknownVtbl
	Lock             uintptr
	Unlock           uintptr
	GetCurrentLength uintptr
	SetCurrentLength uintptr
	GetMaxLength     uintptr
}

type imfMediaBuffer struct {
	vtbl *imfMediaBufferVtbl
}

func (b *imfMediaBuffer) lock() ([]byte, uint32, error) {
	var ptr uintptr
	var maxLen, curLen uint32
	hr, _, _ := syscall.SyscallN(b.vtbl.Lock, uintptr(unsafe.Pointer(b)),
		uintptr(unsafe.Pointer(&ptr)), uintptr(unsafe.Pointer(&maxLen)), uintptr(unsafe.Pointer(&curLen)))
	if hr != 0 {
		return nil, 0, fmt.Errorf("IMFMediaBuffer::Lock: 0x%x", hr)
	}
	// Fatia respaldada na memoria do buffer; valida ate Unlock().
	data := unsafe.Slice((*byte)(unsafe.Pointer(ptr)), int(curLen))
	return data, curLen, nil
}

func (b *imfMediaBuffer) unlock() {
	syscall.SyscallN(b.vtbl.Unlock, uintptr(unsafe.Pointer(b)))
}

func (b *imfMediaBuffer) release() uintptr {
	if b == nil {
		return 0
	}
	r, _, _ := syscall.SyscallN(b.vtbl.Release, uintptr(unsafe.Pointer(b)))
	return r
}

// mfCreateAttributes cria um IMFAttributes com espaco para n itens.
func mfCreateAttributes(n uint32) (*imfAttributes, error) {
	var p *imfAttributes
	hr, _, _ := procMFCreateAttributes.Call(uintptr(unsafe.Pointer(&p)), uintptr(n))
	if hr != 0 {
		return nil, fmt.Errorf("MFCreateAttributes: 0x%x", hr)
	}
	return p, nil
}

func mfCreateMediaType() (*imfMediaType, error) {
	var p *imfMediaType
	hr, _, _ := procMFCreateMediaType.Call(uintptr(unsafe.Pointer(&p)))
	if hr != 0 {
		return nil, fmt.Errorf("MFCreateMediaType: 0x%x", hr)
	}
	return p, nil
}

// mfEnumDeviceSources devolve a lista de IMFActivate das cameras de video. O chamador libera cada
// uma com Release e o vetor com CoTaskMemFree.
func mfEnumDeviceSources(attrs *imfAttributes) ([]*imfActivate, uintptr, error) {
	var arr uintptr
	var count uint32
	hr, _, _ := procMFEnumDeviceSources.Call(uintptr(unsafe.Pointer(attrs)),
		uintptr(unsafe.Pointer(&arr)), uintptr(unsafe.Pointer(&count)))
	if hr != 0 {
		return nil, 0, fmt.Errorf("MFEnumDeviceSources: 0x%x", hr)
	}
	if count == 0 {
		if arr != 0 {
			procCoTaskMemFree.Call(arr)
		}
		return nil, 0, errors.New("nenhuma camera encontrada")
	}
	// arr e um IMFActivate*[]; copiamos os ponteiros para uma fatia Go.
	ptrs := unsafe.Slice((**imfActivate)(unsafe.Pointer(arr)), int(count))
	out := make([]*imfActivate, count)
	copy(out, ptrs)
	return out, arr, nil
}

func mfCreateSourceReaderFromMediaSource(src *imfMediaSource, attrs *imfAttributes) (*imfSourceReader, error) {
	var p *imfSourceReader
	hr, _, _ := procMFCreateSourceReaderFromMediaSource.Call(uintptr(unsafe.Pointer(src)),
		uintptr(unsafe.Pointer(attrs)), uintptr(unsafe.Pointer(&p)))
	if hr != 0 {
		return nil, fmt.Errorf("MFCreateSourceReaderFromMediaSource: 0x%x", hr)
	}
	return p, nil
}

// --- Camera concreta ----------------------------------------------------------------------------

type frameResult struct {
	jpeg []byte
	err  error
}

type winCamera struct {
	opts Options
	req  chan struct{}
	out  chan frameResult
	quit chan struct{}
	done chan struct{} // fechado quando o worker sai
}

// openCamera inicia Media Foundation (uma vez), abre a primeira camera e um IMFSourceReader
// configurado para RGB32 na resolucao pedida.
func openCamera(opts Options) (Camera, error) {
	if err := mfOnce(); err != nil {
		return nil, err
	}
	c := &winCamera{
		opts: opts,
		req:  make(chan struct{}),
		out:  make(chan frameResult, 1),
		quit: make(chan struct{}),
		done: make(chan struct{}),
	}
	ready := make(chan error, 1)
	go c.worker(ready)
	if err := <-ready; err != nil {
		close(c.quit)
		<-c.done
		return nil, err
	}
	return c, nil
}

func (c *winCamera) NextFrame() ([]byte, error) {
	select {
	case c.req <- struct{}{}:
	case <-c.done:
		return nil, errors.New("camera encerrada")
	}
	select {
	case r := <-c.out:
		return r.jpeg, r.err
	case <-c.done:
		return nil, errors.New("camera encerrada")
	}
}

func (c *winCamera) Close() {
	select {
	case <-c.quit:
	default:
		close(c.quit)
	}
	<-c.done
}

// worker e dono do IMFSourceReader e so chama COM pela thread presa dele.
func (c *winCamera) worker(ready chan<- error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	defer close(c.done)

	src, reader, err := c.initReader()
	if err != nil {
		ready <- err
		return
	}
	ready <- nil
	defer reader.release()
	defer func() {
		src.shutdown()
		src.release()
	}()

	buf := bytes.NewBuffer(make([]byte, 0, 64<<10))
	for {
		select {
		case <-c.quit:
			return
		case <-c.req:
			jpeg, err := c.grab(reader, buf)
			select {
			case c.out <- frameResult{jpeg: jpeg, err: err}:
			case <-c.quit:
				return
			}
			if err != nil {
				return
			}
		}
	}
}

// initReader abre a primeira camera e configura o leitor para RGB32 na resolucao pedida.
func (c *winCamera) initReader() (*imfMediaSource, *imfSourceReader, error) {
	// Atributos de enumeracao: tipo de fonte = video capture.
	enumAttrs, err := mfCreateAttributes(1)
	if err != nil {
		return nil, nil, err
	}
	defer enumAttrs.release()
	if err := enumAttrs.setGUID(&guidDevSourceAttributeSourceType, &guidDevSourceAttributeSourceTypeVidcap); err != nil {
		return nil, nil, err
	}
	activates, arr, err := mfEnumDeviceSources(enumAttrs)
	if err != nil {
		return nil, nil, err
	}
	defer procCoTaskMemFree.Call(arr)
	defer func() {
		// Libera todas (a escolhida ganha um AddRef dentro de ActivateObject, entao Release aqui so
		// descarta a referencia da enumeracao).
		for _, a := range activates {
			a.release()
		}
	}()

	// Ativa a primeira camera.
	srcPtr, err := activates[0].activateObject(&guidIidIMFMediaSource)
	if err != nil {
		return nil, nil, err
	}
	src := (*imfMediaSource)(unsafe.Pointer(srcPtr))

	// Atributos do leitor: habilita o processamento de video para que o Media Foundation insira os
	// conversores (YUY2/NV12 -> RGB32) e o escalonamento se a camera nao der o tamanho pedido.
	readerAttrs, err := mfCreateAttributes(1)
	if err != nil {
		src.shutdown()
		src.release()
		return nil, nil, err
	}
	defer readerAttrs.release()
	if err := readerAttrs.setUINT32(&guidSourceReaderEnableVideoProcessing, 1); err != nil {
		src.shutdown()
		src.release()
		return nil, nil, err
	}

	reader, err := mfCreateSourceReaderFromMediaSource(src, readerAttrs)
	if err != nil {
		src.shutdown()
		src.release()
		return nil, nil, err
	}

	// Media type de saida: video RGB32 na resolucao pedida, progressivo.
	mt, err := mfCreateMediaType()
	if err != nil {
		reader.release()
		src.shutdown()
		src.release()
		return nil, nil, err
	}
	defer mt.release()
	a := mt.attrs()
	if err := a.setGUID(&guidMtMajorType, &guidMediaTypeVideo); err != nil {
		reader.release()
		src.shutdown()
		src.release()
		return nil, nil, err
	}
	if err := a.setGUID(&guidMtSubtype, &guidVideoFormatRGB32); err != nil {
		reader.release()
		src.shutdown()
		src.release()
		return nil, nil, err
	}
	frameSize := (uint64(c.opts.Width) << 32) | uint64(c.opts.Height)
	if err := a.setUINT64(&guidMtFrameSize, frameSize); err != nil {
		reader.release()
		src.shutdown()
		src.release()
		return nil, nil, err
	}
	if err := a.setUINT32(&guidMtInterlaceMode, interlaceModeProgressive); err != nil {
		reader.release()
		src.shutdown()
		src.release()
		return nil, nil, err
	}
	if err := reader.setCurrentMediaType(mt); err != nil {
		reader.release()
		src.shutdown()
		src.release()
		return nil, nil, err
	}
	return src, reader, nil
}

// grab le o proximo quadro, converte para image.RGBA (BGRA->RGBA) e codifica em JPEG.
func (c *winCamera) grab(reader *imfSourceReader, buf *bytes.Buffer) ([]byte, error) {
	// ReadSample pode devolver amostra vazia (sample == nil) com flags de troca de tipo ou fluxo
	// novo. Rele ate ter sample ou erro.
	for i := 0; i < 8; i++ {
		sample, flags, err := reader.readSample()
		if err != nil {
			return nil, err
		}
		if flags&mfSourceReaderfError != 0 {
			if sample != nil {
				sample.release()
			}
			return nil, fmt.Errorf("ReadSample reportou erro (flags 0x%x)", flags)
		}
		if flags&mfSourceReaderfEndOfStream != 0 {
			if sample != nil {
				sample.release()
			}
			return nil, errors.New("stream da camera encerrado")
		}
		if sample == nil {
			continue
		}
		jpeg, err := c.sampleToJPEG(sample, buf)
		sample.release()
		return jpeg, err
	}
	return nil, errors.New("ReadSample sem quadro em 8 tentativas")
}

func (c *winCamera) sampleToJPEG(sample *imfSample, buf *bytes.Buffer) ([]byte, error) {
	mb, err := sample.convertToContiguousBuffer()
	if err != nil {
		return nil, err
	}
	defer mb.release()
	data, length, err := mb.lock()
	if err != nil {
		return nil, err
	}
	defer mb.unlock()

	expected := c.opts.Width * c.opts.Height * 4
	if int(length) < expected {
		return nil, fmt.Errorf("buffer menor que o esperado: %d < %d", length, expected)
	}
	// RGB32 do Media Foundation = BGRA, origem no canto inferior esquerdo (stride negativo).
	img := image.NewRGBA(image.Rect(0, 0, c.opts.Width, c.opts.Height))
	stride := c.opts.Width * 4
	for y := 0; y < c.opts.Height; y++ {
		src := data[(c.opts.Height-1-y)*stride : (c.opts.Height-y)*stride]
		dst := img.Pix[y*img.Stride : y*img.Stride+stride]
		for x := 0; x < stride; x += 4 {
			dst[x+0] = src[x+2] // R
			dst[x+1] = src[x+1] // G
			dst[x+2] = src[x+0] // B
			dst[x+3] = 0xFF     // A (alpha da camera e lixo)
		}
	}
	buf.Reset()
	if err := jpeg.Encode(buf, img, &jpeg.Options{Quality: c.opts.Quality}); err != nil {
		return nil, err
	}
	out := make([]byte, buf.Len())
	copy(out, buf.Bytes())
	return out, nil
}
