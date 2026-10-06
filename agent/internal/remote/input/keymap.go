// Package input injeta teclado e mouse na sessao do usuario para o acesso remoto (contrato, secao 5.2).
package input

// keyDef liga um KeyboardEvent.code (posicao fisica da tecla) aos codigos de cada sistema:
// evdev (Linux; no X11 o keycode e evdev+8), scancode do conjunto 1 do Windows (ext = prefixo E0)
// e keycode virtual do macOS (noMac quando a tecla nao existe la).
type keyDef struct {
	evdev uint16
	win   uint16
	ext   bool
	mac   uint16
}

const noMac = 0xffff

// keys cobre o teclado ABNT2/US completo, teclado numerico e teclas de navegacao.
var keys = map[string]keyDef{
	"Escape": {1, 0x01, false, 0x35}, "Digit1": {2, 0x02, false, 0x12}, "Digit2": {3, 0x03, false, 0x13}, "Digit3": {4, 0x04, false, 0x14},
	"Digit4": {5, 0x05, false, 0x15}, "Digit5": {6, 0x06, false, 0x17}, "Digit6": {7, 0x07, false, 0x16}, "Digit7": {8, 0x08, false, 0x1a},
	"Digit8": {9, 0x09, false, 0x1c}, "Digit9": {10, 0x0a, false, 0x19}, "Digit0": {11, 0x0b, false, 0x1d}, "Minus": {12, 0x0c, false, 0x1b},
	"Equal": {13, 0x0d, false, 0x18}, "Backspace": {14, 0x0e, false, 0x33}, "Tab": {15, 0x0f, false, 0x30},
	"KeyQ": {16, 0x10, false, 0x0c}, "KeyW": {17, 0x11, false, 0x0d}, "KeyE": {18, 0x12, false, 0x0e}, "KeyR": {19, 0x13, false, 0x0f},
	"KeyT": {20, 0x14, false, 0x11}, "KeyY": {21, 0x15, false, 0x10}, "KeyU": {22, 0x16, false, 0x20}, "KeyI": {23, 0x17, false, 0x22},
	"KeyO": {24, 0x18, false, 0x1f}, "KeyP": {25, 0x19, false, 0x23}, "BracketLeft": {26, 0x1a, false, 0x21}, "BracketRight": {27, 0x1b, false, 0x1e},
	"Enter": {28, 0x1c, false, 0x24}, "ControlLeft": {29, 0x1d, false, 0x3b},
	"KeyA": {30, 0x1e, false, 0x00}, "KeyS": {31, 0x1f, false, 0x01}, "KeyD": {32, 0x20, false, 0x02}, "KeyF": {33, 0x21, false, 0x03},
	"KeyG": {34, 0x22, false, 0x05}, "KeyH": {35, 0x23, false, 0x04}, "KeyJ": {36, 0x24, false, 0x26}, "KeyK": {37, 0x25, false, 0x28},
	"KeyL": {38, 0x26, false, 0x25}, "Semicolon": {39, 0x27, false, 0x29}, "Quote": {40, 0x28, false, 0x27}, "Backquote": {41, 0x29, false, 0x32},
	"ShiftLeft": {42, 0x2a, false, 0x38}, "Backslash": {43, 0x2b, false, 0x2a},
	"KeyZ": {44, 0x2c, false, 0x06}, "KeyX": {45, 0x2d, false, 0x07}, "KeyC": {46, 0x2e, false, 0x08}, "KeyV": {47, 0x2f, false, 0x09},
	"KeyB": {48, 0x30, false, 0x0b}, "KeyN": {49, 0x31, false, 0x2d}, "KeyM": {50, 0x32, false, 0x2e}, "Comma": {51, 0x33, false, 0x2b},
	"Period": {52, 0x34, false, 0x2f}, "Slash": {53, 0x35, false, 0x2c}, "ShiftRight": {54, 0x36, false, 0x3c},
	"NumpadMultiply": {55, 0x37, false, 0x43}, "AltLeft": {56, 0x38, false, 0x3a}, "Space": {57, 0x39, false, 0x31}, "CapsLock": {58, 0x3a, false, 0x39},
	"F1": {59, 0x3b, false, 0x7a}, "F2": {60, 0x3c, false, 0x78}, "F3": {61, 0x3d, false, 0x63}, "F4": {62, 0x3e, false, 0x76},
	"F5": {63, 0x3f, false, 0x60}, "F6": {64, 0x40, false, 0x61}, "F7": {65, 0x41, false, 0x62}, "F8": {66, 0x42, false, 0x64},
	"F9": {67, 0x43, false, 0x65}, "F10": {68, 0x44, false, 0x6d}, "NumLock": {69, 0x45, false, 0x47}, "ScrollLock": {70, 0x46, false, noMac},
	"Numpad7": {71, 0x47, false, 0x59}, "Numpad8": {72, 0x48, false, 0x5b}, "Numpad9": {73, 0x49, false, 0x5c}, "NumpadSubtract": {74, 0x4a, false, 0x4e},
	"Numpad4": {75, 0x4b, false, 0x56}, "Numpad5": {76, 0x4c, false, 0x57}, "Numpad6": {77, 0x4d, false, 0x58}, "NumpadAdd": {78, 0x4e, false, 0x45},
	"Numpad1": {79, 0x4f, false, 0x53}, "Numpad2": {80, 0x50, false, 0x54}, "Numpad3": {81, 0x51, false, 0x55}, "Numpad0": {82, 0x52, false, 0x52},
	"NumpadDecimal": {83, 0x53, false, 0x41}, "IntlBackslash": {86, 0x56, false, 0x0a}, "F11": {87, 0x57, false, 0x67}, "F12": {88, 0x58, false, 0x6f},
	"IntlRo": {89, 0x73, false, 0x5e}, "NumpadComma": {121, 0x7e, false, 0x5f},
	"NumpadEnter": {96, 0x1c, true, 0x4c}, "ControlRight": {97, 0x1d, true, 0x3e}, "NumpadDivide": {98, 0x35, true, 0x4b},
	"PrintScreen": {99, 0x37, true, noMac}, "AltRight": {100, 0x38, true, 0x3d}, "Home": {102, 0x47, true, 0x73}, "ArrowUp": {103, 0x48, true, 0x7e},
	"PageUp": {104, 0x49, true, 0x74}, "ArrowLeft": {105, 0x4b, true, 0x7b}, "ArrowRight": {106, 0x4d, true, 0x7c}, "End": {107, 0x4f, true, 0x77},
	"ArrowDown": {108, 0x50, true, 0x7d}, "PageDown": {109, 0x51, true, 0x79}, "Insert": {110, 0x52, true, 0x72}, "Delete": {111, 0x53, true, 0x75},
	"Pause": {119, 0x45, false, noMac}, "MetaLeft": {125, 0x5b, true, 0x37}, "MetaRight": {126, 0x5c, true, 0x36}, "ContextMenu": {127, 0x5d, true, 0x6e},
}

// lookup devolve a definicao da tecla.
func lookup(code string) (keyDef, bool) {
	k, ok := keys[code]
	return k, ok
}
