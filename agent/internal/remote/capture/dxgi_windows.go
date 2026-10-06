//go:build windows

package capture

// Captura por DXGI Desktop Duplication (Windows 8 ou mais novo), em Go puro: as chamadas COM vao direto pela
// vtable. A GPU entrega so os quadros em que algo mudou, com a lista de regioes alteradas; com a tela parada
// AcquireNextFrame volta na hora sem trabalho nenhum. Posicoes da vtable e GUIDs conferidos com o SDK do Windows
// (e com github.com/kirides/go-d3d, MIT).

import (
	"errors"
	"fmt"
	"image"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	d3d11dll               = windows.NewLazySystemDLL("d3d11.dll")
	dxgidll                = windows.NewLazySystemDLL("dxgi.dll")
	procD3D11CreateDevice  = d3d11dll.NewProc("D3D11CreateDevice")
	procCreateDXGIFactory1 = dxgidll.NewProc("CreateDXGIFactory1")

	iidIDXGIFactory1   = windows.GUID{Data1: 0x770aae78, Data2: 0xf26f, Data3: 0x4dba, Data4: [8]byte{0xa8, 0x29, 0x25, 0x3c, 0x83, 0xd1, 0xb3, 0x87}}
	iidIDXGIOutput1    = windows.GUID{Data1: 0x00cddea8, Data2: 0x939b, Data3: 0x4b83, Data4: [8]byte{0xa3, 0x40, 0xa6, 0x85, 0x22, 0x66, 0x66, 0xcc}}
	iidID3D11Texture2D = windows.GUID{Data1: 0x6f15aaf2, Data2: 0xd208, Data3: 0x4e89, Data4: [8]byte{0x9a, 0xb4, 0x48, 0x95, 0x35, 0xd3, 0x4f, 0x9c}}
)

// Posicoes na vtable.
const (
	vRelease = 2
	vQI      = 0

	vFactory1EnumAdapters1 = 12 // IDXGIFactory1
	vAdapterEnumOutputs    = 7  // IDXGIAdapter
	vOutputGetDesc         = 7  // IDXGIOutput
	vOutput1DuplicateOut   = 22 // IDXGIOutput1

	vDupGetDesc            = 7 // IDXGIOutputDuplication
	vDupAcquireNextFrame   = 8
	vDupGetFrameDirtyRects = 9
	vDupGetFrameMoveRects  = 10
	vDupMapDesktopSurface  = 12
	vDupUnMapDesktopSurf   = 13
	vDupReleaseFrame       = 14

	vDeviceCreateTexture2D = 5 // ID3D11Device

	vCtxMap                   = 14 // ID3D11DeviceContext
	vCtxUnmap                 = 15
	vCtxCopySubresourceRegion = 46
	vCtxCopyResource          = 47
)

const (
	hrWaitTimeout = 0x887A0027
	hrAccessLost  = 0x887A0026
	hrInvalidArg  = 0x80070057
	hrUnsupported = 0x887A0004

	d3d11SDKVersion     = 7
	formatB8G8R8A8      = 87
	usageStaging        = 3
	cpuAccessRead       = 0x20000
	mapRead             = 1
	rotationIdentity    = 1
	rotationUnspecified = 0
)

type hresult uint32

func (h hresult) Error() string { return fmt.Sprintf("HRESULT 0x%08X", uint32(h)) }

func failed(hr uintptr) bool { return int32(uint32(hr)) < 0 }

// comCall chama o metodo index da vtable do objeto COM obj. Como no LazyProc.Call, os ponteiros convertidos para
// uintptr nos argumentos vao para o heap e ficam vivos ate o fim da chamada.
//
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

func comRelease(obj unsafe.Pointer) {
	if obj != nil {
		comCall(obj, vRelease)
	}
}

type outputDesc struct {
	DeviceName [32]uint16
	Coords     rect
	Attached   int32
	Rotation   uint32
	Monitor    uintptr
}

type outduplDesc struct {
	Width, Height          uint32
	RefreshNum, RefreshDen uint32
	Format                 uint32
	Scanline               uint32
	Scaling                uint32
	Rotation               uint32
	InSystemMemory         int32
}

type frameInfo struct {
	LastPresentTime     int64
	LastMouseUpdateTime int64
	AccumulatedFrames   uint32
	RectsCoalesced      uint32
	ProtectedMasked     uint32
	PointerX, PointerY  int32
	PointerVisible      int32
	TotalMetadataSize   uint32
	PointerShapeSize    uint32
}

type texture2DDesc struct {
	Width, Height, MipLevels, ArraySize, Format uint32
	SampleCount, SampleQuality                  uint32
	Usage, BindFlags, CPUAccessFlags, MiscFlags uint32
}

type box struct{ Left, Top, Front, Right, Bottom, Back uint32 }

type mapped struct {
	Data       unsafe.Pointer
	RowPitch   uint32
	DepthPitch uint32
}

// mappedRect e o DXGI_MAPPED_RECT do MapDesktopSurface.
type mappedRect struct {
	Pitch int32
	Bits  unsafe.Pointer
}

type moveRect struct {
	SrcX, SrcY int32
	Dst        rect
}

// dxgiDup e a duplicacao de um monitor: dispositivo D3D11 do adaptador do monitor, duplicacao e textura de
// leitura (staging) do tamanho da tela.
type dxgiDup struct {
	name    string
	device  unsafe.Pointer
	context unsafe.Pointer
	dup     unsafe.Pointer
	staging unsafe.Pointer
	w, h    int
	sysmem  bool   // imagem na memoria do sistema (adaptador basico, VM): lida pelo MapDesktopSurface
	fresh   bool   // ainda sem a primeira imagem: o proximo quadro copia a tela inteira
	gen     uint64 // area de trabalho da duplicacao (windesk)
	meta    []byte
}

var errDXGIUnavailable = errors.New("DXGI Desktop Duplication indisponivel")

// openDXGI acha a saida (monitor) com o nome do Display, cria o dispositivo no adaptador dela e a duplicacao.
// Deve rodar na thread do windesk (a duplicacao pertence a area de trabalho da thread).
func openDXGI(d Display) (*dxgiDup, error) {
	if procCreateDXGIFactory1.Find() != nil || procD3D11CreateDevice.Find() != nil {
		return nil, errDXGIUnavailable
	}
	var factory unsafe.Pointer
	if hr, _, _ := procCreateDXGIFactory1.Call(uintptr(unsafe.Pointer(&iidIDXGIFactory1)), uintptr(unsafe.Pointer(&factory))); failed(hr) || factory == nil {
		return nil, fmt.Errorf("CreateDXGIFactory1: %w", hresult(hr))
	}
	defer comRelease(factory)
	for ai := uint32(0); ; ai++ {
		var adapter unsafe.Pointer
		if hr := comCall(factory, vFactory1EnumAdapters1, uintptr(ai), uintptr(unsafe.Pointer(&adapter))); failed(hr) || adapter == nil {
			break
		}
		for oi := uint32(0); ; oi++ {
			var output unsafe.Pointer
			if hr := comCall(adapter, vAdapterEnumOutputs, uintptr(oi), uintptr(unsafe.Pointer(&output))); failed(hr) || output == nil {
				break
			}
			var desc outputDesc
			comCall(output, vOutputGetDesc, uintptr(unsafe.Pointer(&desc)))
			name := windows.UTF16ToString(desc.DeviceName[:])
			if !strings.EqualFold(name, d.Name) {
				comRelease(output)
				continue
			}
			dup, err := duplicate(adapter, output, name)
			comRelease(output)
			comRelease(adapter)
			return dup, err
		}
		comRelease(adapter)
	}
	return nil, fmt.Errorf("%w: monitor %q nao encontrado", errDXGIUnavailable, d.Name)
}

func duplicate(adapter, output unsafe.Pointer, name string) (*dxgiDup, error) {
	levels := [...]uint32{0xb100, 0xb000, 0xa100, 0xa000, 0x9300, 0x9200, 0x9100}
	var device, context unsafe.Pointer
	var level uint32
	hr, _, _ := procD3D11CreateDevice.Call(uintptr(adapter), 0 /* D3D_DRIVER_TYPE_UNKNOWN */, 0, 0,
		uintptr(unsafe.Pointer(&levels[0])), uintptr(len(levels)), d3d11SDKVersion,
		uintptr(unsafe.Pointer(&device)), uintptr(unsafe.Pointer(&level)), uintptr(unsafe.Pointer(&context)))
	if uint32(hr) == hrInvalidArg {
		// Runtime sem o nivel 11.1 (Windows 7 com D3D 11.0): tenta sem ele.
		hr, _, _ = procD3D11CreateDevice.Call(uintptr(adapter), 0, 0, 0,
			uintptr(unsafe.Pointer(&levels[1])), uintptr(len(levels)-1), d3d11SDKVersion,
			uintptr(unsafe.Pointer(&device)), uintptr(unsafe.Pointer(&level)), uintptr(unsafe.Pointer(&context)))
	}
	if failed(hr) || device == nil || context == nil {
		comRelease(context)
		comRelease(device)
		return nil, fmt.Errorf("%w: D3D11CreateDevice %v", errDXGIUnavailable, hresult(hr))
	}
	d := &dxgiDup{name: name, device: device, context: context, fresh: true}
	var output1 unsafe.Pointer
	if hr := comCall(output, vQI, uintptr(unsafe.Pointer(&iidIDXGIOutput1)), uintptr(unsafe.Pointer(&output1))); failed(hr) || output1 == nil {
		d.release()
		return nil, fmt.Errorf("IDXGIOutput1: %w", hresult(hr))
	}
	hr = comCall(output1, vOutput1DuplicateOut, uintptr(device), uintptr(unsafe.Pointer(&d.dup)))
	comRelease(output1)
	if failed(hr) || d.dup == nil {
		d.release()
		if uint32(hr) == hrUnsupported {
			// Sessao de Area de Trabalho Remota ou driver sem suporte: nao adianta tentar de novo logo.
			return nil, fmt.Errorf("%w: DuplicateOutput %v", errDXGIUnavailable, hresult(hr))
		}
		// E_ACCESSDENIED na tela segura sem permissao, limite de duplicacoes: passageiro.
		return nil, fmt.Errorf("DuplicateOutput: %w", hresult(hr))
	}
	var desc outduplDesc
	comCall(d.dup, vDupGetDesc, uintptr(unsafe.Pointer(&desc)))
	if desc.Rotation != rotationIdentity && desc.Rotation != rotationUnspecified {
		d.release()
		return nil, fmt.Errorf("%w: monitor girado", errDXGIUnavailable)
	}
	d.w, d.h = int(desc.Width), int(desc.Height)
	if desc.InSystemMemory != 0 {
		// Adaptador sem memoria de video propria (VM, driver basico): a imagem ja esta na memoria do sistema e e
		// lida direto, sem textura de copia.
		d.sysmem = true
		return d, nil
	}
	td := texture2DDesc{Width: desc.Width, Height: desc.Height, MipLevels: 1, ArraySize: 1, Format: formatB8G8R8A8,
		SampleCount: 1, Usage: usageStaging, CPUAccessFlags: cpuAccessRead}
	if hr := comCall(device, vDeviceCreateTexture2D, uintptr(unsafe.Pointer(&td)), 0, uintptr(unsafe.Pointer(&d.staging))); failed(hr) || d.staging == nil {
		d.release()
		return nil, fmt.Errorf("CreateTexture2D: %w", hresult(hr))
	}
	return d, nil
}

func (d *dxgiDup) release() {
	comRelease(d.staging)
	comRelease(d.dup)
	comRelease(d.context)
	comRelease(d.device)
	d.staging, d.dup, d.context, d.device = nil, nil, nil, nil
}

// grab pega o proximo quadro sem esperar. Devolve as regioes copiadas para f.Img (vazio sem mudanca; full quando
// a tela inteira foi copiada). Na thread do windesk.
func (d *dxgiDup) grab(f *Frame) (regions []image.Rectangle, changed, full bool, err error) {
	var info frameInfo
	var resource unsafe.Pointer
	hr := comCall(d.dup, vDupAcquireNextFrame, 0, uintptr(unsafe.Pointer(&info)), uintptr(unsafe.Pointer(&resource)))
	switch {
	case uint32(hr) == hrWaitTimeout:
		// Nada mudou (ou o primeiro quadro, que o DXGI entrega logo apos criar a duplicacao, ainda nao chegou).
		return nil, false, false, nil
	case uint32(hr) == hrAccessLost:
		return nil, false, false, fmt.Errorf("DXGI: acesso perdido (troca de area de trabalho ou de resolucao)")
	case failed(hr):
		return nil, false, false, fmt.Errorf("AcquireNextFrame: %w", hresult(hr))
	}
	released := false
	defer func() {
		if !released {
			comCall(d.dup, vDupReleaseFrame)
		}
		comRelease(resource)
	}()
	if info.AccumulatedFrames == 0 {
		// So o ponteiro mudou (logo depois de criar a duplicacao, a imagem pode ainda nao ser valida).
		return nil, false, false, nil
	}
	if d.sysmem {
		return d.grabSystemMemory(f, info)
	}
	var tex unsafe.Pointer
	if hr := comCall(resource, vQI, uintptr(unsafe.Pointer(&iidID3D11Texture2D)), uintptr(unsafe.Pointer(&tex))); failed(hr) || tex == nil {
		return nil, false, false, fmt.Errorf("ID3D11Texture2D: %w", hresult(hr))
	}
	defer comRelease(tex)

	full = d.fresh || info.TotalMetadataSize == 0
	if !full {
		regions, err = d.changedRects(info.TotalMetadataSize)
		if err != nil {
			full = true
		}
	}
	if full {
		comCall(d.context, vCtxCopyResource, uintptr(d.staging), uintptr(tex))
		regions = []image.Rectangle{image.Rect(0, 0, d.w, d.h)}
	} else {
		for _, r := range regions {
			b := box{Left: uint32(r.Min.X), Top: uint32(r.Min.Y), Front: 0, Right: uint32(r.Max.X), Bottom: uint32(r.Max.Y), Back: 1}
			comCall(d.context, vCtxCopySubresourceRegion, uintptr(d.staging), 0, uintptr(b.Left), uintptr(b.Top), 0, uintptr(tex), 0, uintptr(unsafe.Pointer(&b)))
		}
	}
	var m mapped
	if hr := comCall(d.context, vCtxMap, uintptr(d.staging), 0, mapRead, 0, uintptr(unsafe.Pointer(&m))); failed(hr) || m.Data == nil {
		return nil, false, false, fmt.Errorf("Map: %w", hresult(hr))
	}
	// O Map ja esperou a copia da GPU: o quadro pode ser devolvido ao Windows antes da conversao.
	comCall(d.dup, vDupReleaseFrame)
	released = true
	img := ensureImage(f, d.w, d.h)
	pitch := int(m.RowPitch)
	src := unsafe.Slice((*byte)(m.Data), pitch*d.h)
	for _, r := range regions {
		convertBGRA(img, src, pitch, r)
	}
	comCall(d.context, vCtxUnmap, uintptr(d.staging), 0)
	d.fresh = false
	return regions, true, full, nil
}

// grabSystemMemory le as regioes do quadro adquirido direto da imagem na memoria do sistema (MapDesktopSurface).
// O ReleaseFrame fica com quem chamou, depois do UnMapDesktopSurface.
func (d *dxgiDup) grabSystemMemory(f *Frame, info frameInfo) (regions []image.Rectangle, changed, full bool, err error) {
	full = d.fresh || info.TotalMetadataSize == 0
	if !full {
		if regions, err = d.changedRects(info.TotalMetadataSize); err != nil {
			full = true
		}
	}
	if full {
		regions = []image.Rectangle{image.Rect(0, 0, d.w, d.h)}
	}
	var mr mappedRect
	if hr := comCall(d.dup, vDupMapDesktopSurface, uintptr(unsafe.Pointer(&mr))); failed(hr) || mr.Bits == nil || mr.Pitch < int32(d.w*4) {
		return nil, false, false, fmt.Errorf("MapDesktopSurface: %w", hresult(hr))
	}
	img := ensureImage(f, d.w, d.h)
	pitch := int(mr.Pitch)
	src := unsafe.Slice((*byte)(mr.Bits), pitch*d.h)
	for _, r := range regions {
		convertBGRA(img, src, pitch, r)
	}
	comCall(d.dup, vDupUnMapDesktopSurf)
	d.fresh = false
	return regions, true, full, nil
}

// changedRects le os retangulos movidos (destino) e alterados do quadro atual, recortados a tela.
func (d *dxgiDup) changedRects(total uint32) ([]image.Rectangle, error) {
	if int(total) > len(d.meta) {
		d.meta = make([]byte, total)
	}
	bounds := image.Rect(0, 0, d.w, d.h)
	var out []image.Rectangle
	var used uint32
	if hr := comCall(d.dup, vDupGetFrameMoveRects, uintptr(len(d.meta)), uintptr(unsafe.Pointer(&d.meta[0])), uintptr(unsafe.Pointer(&used))); failed(hr) {
		return nil, fmt.Errorf("GetFrameMoveRects: %w", hresult(hr))
	}
	n := int(used) / int(unsafe.Sizeof(moveRect{}))
	if n > 0 {
		moves := unsafe.Slice((*moveRect)(unsafe.Pointer(&d.meta[0])), n)
		for _, m := range moves {
			if r := image.Rect(int(m.Dst.Left), int(m.Dst.Top), int(m.Dst.Right), int(m.Dst.Bottom)).Intersect(bounds); !r.Empty() {
				out = append(out, r)
			}
		}
	}
	used = 0
	if hr := comCall(d.dup, vDupGetFrameDirtyRects, uintptr(len(d.meta)), uintptr(unsafe.Pointer(&d.meta[0])), uintptr(unsafe.Pointer(&used))); failed(hr) {
		return nil, fmt.Errorf("GetFrameDirtyRects: %w", hresult(hr))
	}
	n = int(used) / int(unsafe.Sizeof(rect{}))
	if n > 0 {
		dirty := unsafe.Slice((*rect)(unsafe.Pointer(&d.meta[0])), n)
		for _, r := range dirty {
			if rr := image.Rect(int(r.Left), int(r.Top), int(r.Right), int(r.Bottom)).Intersect(bounds); !rr.Empty() {
				out = append(out, rr)
			}
		}
	}
	return out, nil
}
