//go:build darwin

package macos

import (
	"errors"
	"fmt"
	"runtime"
	"sync"
	"unsafe"

	"github.com/ebitengine/purego"
	"github.com/ebitengine/purego/objc"
)

// CGPoint, CGSize e CGRect seguem o layout do CoreGraphics (CGFloat de 64 bits).
type CGPoint struct{ X, Y float64 }

type CGSize struct{ W, H float64 }

type CGRect struct {
	Origin CGPoint
	Size   CGSize
}

// Funcoes carregadas em Load.
var (
	CGGetActiveDisplayList          func(max uint32, displays *uint32, count *uint32) int32
	CGMainDisplayID                 func() uint32
	CGDisplayBounds                 func(display uint32) CGRect
	CGDisplayCreateImage            func(display uint32) uintptr
	CGImageGetWidth                 func(img uintptr) uintptr
	CGImageGetHeight                func(img uintptr) uintptr
	CGImageGetBytesPerRow           func(img uintptr) uintptr
	CGImageGetBitsPerPixel          func(img uintptr) uintptr
	CGImageGetDataProvider          func(img uintptr) uintptr
	CGDataProviderCopyData          func(provider uintptr) uintptr
	CGImageRelease                  func(img uintptr)
	CGEventCreateMouseEvent         func(source uintptr, typ uint32, point CGPoint, button uint32) uintptr
	CGEventCreateKeyboardEvent      func(source uintptr, key uint16, down bool) uintptr
	CGEventKeyboardSetUnicodeString func(event uintptr, length uintptr, str *uint16)
	CGEventCreateScrollWheelEvent2  func(source uintptr, units uint32, count uint32, w1, w2, w3 int32) uintptr
	CGEventSetFlags                 func(event uintptr, flags uint64)
	CGEventPost                     func(tap uint32, event uintptr)
	CGPreflightScreenCaptureAccess  func() bool
	CGRequestScreenCaptureAccess    func() bool
	CFDataGetBytePtr                func(data uintptr) uintptr
	CFDataGetLength                 func(data uintptr) int
	CFRelease                       func(ref uintptr)
	AXIsProcessTrusted              func() bool
)

var (
	once    sync.Once
	loadErr error
)

const (
	coreGraphics = "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"
	coreFound    = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
	appServices  = "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"
	appKit       = "/System/Library/Frameworks/AppKit.framework/AppKit"
)

// Load carrega os frameworks uma vez.
func Load() error {
	once.Do(func() {
		defer func() {
			if r := recover(); r != nil {
				loadErr = fmt.Errorf("funcao do macOS indisponivel: %v", r)
			}
		}()
		cg, err := purego.Dlopen(coreGraphics, purego.RTLD_NOW|purego.RTLD_GLOBAL)
		if err != nil {
			loadErr = err
			return
		}
		cf, err := purego.Dlopen(coreFound, purego.RTLD_NOW|purego.RTLD_GLOBAL)
		if err != nil {
			loadErr = err
			return
		}
		as, err := purego.Dlopen(appServices, purego.RTLD_NOW|purego.RTLD_GLOBAL)
		if err != nil {
			loadErr = err
			return
		}
		if _, err := purego.Dlopen(appKit, purego.RTLD_NOW|purego.RTLD_GLOBAL); err != nil {
			loadErr = err
			return
		}
		purego.RegisterLibFunc(&CGGetActiveDisplayList, cg, "CGGetActiveDisplayList")
		purego.RegisterLibFunc(&CGMainDisplayID, cg, "CGMainDisplayID")
		purego.RegisterLibFunc(&CGDisplayBounds, cg, "CGDisplayBounds")
		purego.RegisterLibFunc(&CGDisplayCreateImage, cg, "CGDisplayCreateImage")
		purego.RegisterLibFunc(&CGImageGetWidth, cg, "CGImageGetWidth")
		purego.RegisterLibFunc(&CGImageGetHeight, cg, "CGImageGetHeight")
		purego.RegisterLibFunc(&CGImageGetBytesPerRow, cg, "CGImageGetBytesPerRow")
		purego.RegisterLibFunc(&CGImageGetBitsPerPixel, cg, "CGImageGetBitsPerPixel")
		purego.RegisterLibFunc(&CGImageGetDataProvider, cg, "CGImageGetDataProvider")
		purego.RegisterLibFunc(&CGDataProviderCopyData, cg, "CGDataProviderCopyData")
		purego.RegisterLibFunc(&CGImageRelease, cg, "CGImageRelease")
		purego.RegisterLibFunc(&CGEventCreateMouseEvent, cg, "CGEventCreateMouseEvent")
		purego.RegisterLibFunc(&CGEventCreateKeyboardEvent, cg, "CGEventCreateKeyboardEvent")
		purego.RegisterLibFunc(&CGEventKeyboardSetUnicodeString, cg, "CGEventKeyboardSetUnicodeString")
		purego.RegisterLibFunc(&CGEventCreateScrollWheelEvent2, cg, "CGEventCreateScrollWheelEvent2")
		purego.RegisterLibFunc(&CGEventSetFlags, cg, "CGEventSetFlags")
		purego.RegisterLibFunc(&CGEventPost, cg, "CGEventPost")
		purego.RegisterLibFunc(&CGPreflightScreenCaptureAccess, cg, "CGPreflightScreenCaptureAccess")
		purego.RegisterLibFunc(&CGRequestScreenCaptureAccess, cg, "CGRequestScreenCaptureAccess")
		purego.RegisterLibFunc(&CFDataGetBytePtr, cf, "CFDataGetBytePtr")
		purego.RegisterLibFunc(&CFDataGetLength, cf, "CFDataGetLength")
		purego.RegisterLibFunc(&CFRelease, cf, "CFRelease")
		purego.RegisterLibFunc(&AXIsProcessTrusted, as, "AXIsProcessTrusted")
	})
	return loadErr
}

// Bytes copia n bytes de memoria do sistema (CFData) para o Go.
func Bytes(p uintptr, n int) []byte {
	if p == 0 || n <= 0 {
		return nil
	}
	src := unsafe.Slice((*byte)(*(*unsafe.Pointer)(unsafe.Pointer(&p))), n)
	return append([]byte(nil), src...)
}

var (
	selNew        = objc.RegisterName("new")
	selDrain      = objc.RegisterName("drain")
	selGeneral    = objc.RegisterName("generalPasteboard")
	selChange     = objc.RegisterName("changeCount")
	selStringFor  = objc.RegisterName("stringForType:")
	selClear      = objc.RegisterName("clearContents")
	selSetString  = objc.RegisterName("setString:forType:")
	selWithUTF8   = objc.RegisterName("stringWithUTF8String:")
	selUTF8String = objc.RegisterName("UTF8String")
	selLength     = objc.RegisterName("lengthOfBytesUsingEncoding:")
)

const utf8Encoding = 4 // NSUTF8StringEncoding

// pool cria um NSAutoreleasePool para chamadas fora da thread principal.
func pool() func() {
	p := objc.ID(objc.GetClass("NSAutoreleasePool")).Send(selNew)
	return func() { p.Send(selDrain) }
}

func nsString(s string) objc.ID {
	b := append([]byte(s), 0)
	id := objc.ID(objc.GetClass("NSString")).Send(selWithUTF8, &b[0])
	runtime.KeepAlive(b)
	return id
}

func goString(id objc.ID) string {
	if id == 0 {
		return ""
	}
	n := objc.Send[uintptr](id, selLength, utf8Encoding)
	p := objc.Send[uintptr](id, selUTF8String)
	return string(Bytes(p, int(n)))
}

const pasteboardText = "public.utf8-plain-text"

// PasteboardChangeCount devolve o contador de mudancas da area de transferencia geral.
func PasteboardChangeCount() int {
	defer pool()()
	pb := objc.ID(objc.GetClass("NSPasteboard")).Send(selGeneral)
	return objc.Send[int](pb, selChange)
}

// PasteboardText le o texto da area de transferencia geral.
func PasteboardText() string {
	defer pool()()
	pb := objc.ID(objc.GetClass("NSPasteboard")).Send(selGeneral)
	return goString(pb.Send(selStringFor, nsString(pasteboardText)))
}

// SetPasteboardText grava o texto na area de transferencia geral.
func SetPasteboardText(text string) error {
	defer pool()()
	pb := objc.ID(objc.GetClass("NSPasteboard")).Send(selGeneral)
	pb.Send(selClear)
	if !objc.Send[bool](pb, selSetString, nsString(text), nsString(pasteboardText)) {
		return errors.New("NSPasteboard recusou o texto")
	}
	return nil
}
