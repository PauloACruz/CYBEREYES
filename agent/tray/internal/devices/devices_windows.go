//go:build windows

package devices

import (
	"errors"
	"strconv"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// Propriedades do modelo unificado de dispositivos (devpkey.h).
var (
	// Nome que o proprio aparelho informa ao barramento ("USB Receiver", "SanDisk 3.2Gen1").
	devpkeyBusReportedDeviceDesc = windows.DEVPROPKEY{
		FmtID: windows.DEVPROPGUID{Data1: 0x540b947e, Data2: 0x8b40, Data3: 0x45bc, Data4: [8]byte{0xa8, 0xa2, 0x6a, 0x0b, 0x89, 0x4c, 0xbd, 0xa2}},
		PID:   4,
	}
	// Instance ID do dispositivo pai.
	devpkeyParent = windows.DEVPROPKEY{
		FmtID: windows.DEVPROPGUID{Data1: 0x4340a6c5, Data2: 0x93fa, Data3: 0x4706, Data4: [8]byte{0x97, 0x2c, 0x7b, 0x64, 0x80, 0x08, 0xa5, 0xa7}},
		PID:   8,
	}
)

// Enumeradores de dispositivos virtuais (area de trabalho remota, cameras de software), que nao sao
// perifericos de verdade.
var virtualEnumerators = map[string]bool{"ROOT": true, "SWD": true, "TERMINPUT_BUS": true, "SW": true}

// Servicos dos hubs USB: nao sao aparelhos que o usuario conecta.
var hubServices = map[string]bool{"usbhub": true, "usbhub3": true}

type pnpNode struct {
	id, class, enumerator, service, name, busDesc, mfg, parent string
	ok                                                         bool
	problem                                                    string
}

// List le os dispositivos presentes pela SetupAPI, como o Gerenciador de Dispositivos.
func List() Snapshot {
	nodes, err := enumerate()
	if err != nil {
		return Snapshot{Supported: true, Devices: []Device{}, Error: "Não foi possível ler os dispositivos: " + err.Error()}
	}
	out := []Device{}
	for _, n := range nodes {
		if virtualEnumerators[n.enumerator] {
			continue
		}
		kind := kindOf(n, nodes)
		if kind == "" {
			continue
		}
		d := Device{ID: n.id, Kind: kind, Name: n.name, Bus: busOf(n, nodes), OK: n.ok, Problem: n.problem}
		if !strings.HasPrefix(n.mfg, "(") {
			d.Manufacturer = n.mfg
		}
		if kind == KindUSB && n.busDesc != "" {
			// No aparelho USB o nome do barramento e o modelo ("USB Receiver"); o do driver e generico.
			d.Name, d.Model = n.busDesc, n.name
		} else if m := modelOf(n, nodes); m != "" && !strings.EqualFold(m, n.name) {
			d.Model = m
		}
		out = append(out, d)
	}
	sortDevices(out)
	return Snapshot{Supported: true, Devices: out}
}

func kindOf(n *pnpNode, nodes map[string]*pnpNode) string {
	switch strings.ToLower(n.class) {
	case "keyboard":
		return KindKeyboard
	case "mouse":
		if isTouchpadName(n.name) || isTouchpadName(modelOf(n, nodes)) {
			return KindTouchpad
		}
		return KindPointer
	case "hidclass":
		if isTouchpadName(n.name) {
			return KindTouchpad
		}
	case "camera", "image":
		return KindCamera
	}
	id := strings.ToUpper(n.id)
	if n.enumerator == "USB" && !strings.Contains(id, "&MI_") && !strings.Contains(id, "ROOT_HUB") && !hubServices[strings.ToLower(n.service)] {
		return KindUSB
	}
	return ""
}

// ancestors devolve o no e os pais ate a raiz (no maximo 8 niveis).
func ancestors(n *pnpNode, nodes map[string]*pnpNode) []*pnpNode {
	chain := []*pnpNode{n}
	for len(chain) < 8 {
		p, ok := nodes[strings.ToUpper(chain[len(chain)-1].parent)]
		if !ok {
			break
		}
		chain = append(chain, p)
	}
	return chain
}

// busOf sobe pelos pais ate achar o barramento: o primeiro USB ou Bluetooth vence; ACPI e PCI sem
// nenhum dos dois antes sao o teclado, o touchpad ou a camera internos.
func busOf(n *pnpNode, nodes map[string]*pnpNode) string {
	for _, a := range ancestors(n, nodes) {
		switch {
		case a.enumerator == "USB":
			return BusUSB
		case strings.HasPrefix(a.enumerator, "BTH"):
			return BusBluetooth
		case a.enumerator == "ACPI" || a.enumerator == "PCI":
			return BusInternal
		}
	}
	return ""
}

// modelOf e o primeiro nome informado pelo barramento no no ou nos pais (o teclado HID nao tem o
// seu; o receptor USB de onde ele vem, sim).
func modelOf(n *pnpNode, nodes map[string]*pnpNode) string {
	for _, a := range ancestors(n, nodes) {
		if a.busDesc != "" {
			return a.busDesc
		}
	}
	return ""
}

func enumerate() (map[string]*pnpNode, error) {
	set, err := windows.SetupDiGetClassDevsEx(nil, "", 0, windows.DIGCF_PRESENT|windows.DIGCF_ALLCLASSES, 0, "")
	if err != nil {
		return nil, err
	}
	defer set.Close()
	nodes := map[string]*pnpNode{}
	for i := 0; ; i++ {
		data, err := set.EnumDeviceInfo(i)
		if errors.Is(err, windows.ERROR_NO_MORE_ITEMS) {
			break
		}
		if err != nil {
			continue
		}
		id, err := set.DeviceInstanceID(data)
		if err != nil || id == "" {
			continue
		}
		n := &pnpNode{
			id:         id,
			class:      regString(set, data, windows.SPDRP_CLASS),
			enumerator: strings.ToUpper(regString(set, data, windows.SPDRP_ENUMERATOR_NAME)),
			service:    regString(set, data, windows.SPDRP_SERVICE),
			mfg:        regString(set, data, windows.SPDRP_MFG),
			name:       regString(set, data, windows.SPDRP_FRIENDLYNAME),
			busDesc:    propString(set, data, &devpkeyBusReportedDeviceDesc),
			parent:     propString(set, data, &devpkeyParent),
			ok:         true,
		}
		if n.name == "" {
			n.name = regString(set, data, windows.SPDRP_DEVICEDESC)
		}
		var status, problem uint32
		if windows.CM_Get_DevNode_Status(&status, &problem, data.DevInst, 0) == nil && status&windows.DN_HAS_PROBLEM != 0 {
			n.ok = false
			n.problem = problemText(problem)
		}
		nodes[strings.ToUpper(id)] = n
	}
	return nodes, nil
}

func regString(set windows.DevInfo, data *windows.DevInfoData, prop windows.SPDRP) string {
	v, err := set.DeviceRegistryProperty(data, prop)
	if err != nil {
		return ""
	}
	s, _ := v.(string)
	return strings.TrimSpace(s)
}

func propString(set windows.DevInfo, data *windows.DevInfoData, key *windows.DEVPROPKEY) string {
	v, err := windows.SetupDiGetDeviceProperty(set, data, key)
	if err != nil {
		return ""
	}
	s, _ := v.(string)
	return strings.TrimSpace(s)
}

var (
	user32                    = windows.NewLazySystemDLL("user32.dll")
	procGetKeyboardLayoutList = user32.NewProc("GetKeyboardLayoutList")
)

const keyboardLayoutsKey = `SYSTEM\CurrentControlSet\Control\Keyboard Layouts`

var (
	layoutIDsOnce sync.Once
	layoutIDs     map[uint16]string // "Layout Id" -> KLID
)

// KeyboardLayout devolve o layout ativo na janela em primeiro plano (a do proprio app enquanto o
// usuario digita no teste) e os layouts instalados na sessao.
func KeyboardLayout() Layout {
	var tid uint32
	if hwnd := windows.GetForegroundWindow(); hwnd != 0 {
		tid, _ = windows.GetWindowThreadProcessId(hwnd, nil)
	}
	hkl := uint32(windows.GetKeyboardLayout(tid))
	klid := klidFromHKL(hkl, lookupLayoutID)
	l := Layout{ID: klid, Name: layoutName(klid)}
	for _, h := range installedHKLs() {
		k := klidFromHKL(h, lookupLayoutID)
		name := layoutName(k)
		if k != klid && !containsString(l.Installed, name) {
			l.Installed = append(l.Installed, name)
		}
	}
	return l
}

func installedHKLs() []uint32 {
	n, _, _ := procGetKeyboardLayoutList.Call(0, 0)
	if n == 0 || n > 64 {
		return nil
	}
	buf := make([]uintptr, n)
	got, _, _ := procGetKeyboardLayoutList.Call(n, uintptr(unsafe.Pointer(&buf[0])))
	out := make([]uint32, 0, got)
	for _, h := range buf[:got] {
		out = append(out, uint32(h))
	}
	return out
}

func lookupLayoutID(id uint16) string {
	layoutIDsOnce.Do(func() {
		layoutIDs = map[uint16]string{}
		root, err := registry.OpenKey(registry.LOCAL_MACHINE, keyboardLayoutsKey, registry.ENUMERATE_SUB_KEYS)
		if err != nil {
			return
		}
		defer root.Close()
		names, _ := root.ReadSubKeyNames(-1)
		for _, klid := range names {
			k, err := registry.OpenKey(root, klid, registry.QUERY_VALUE)
			if err != nil {
				continue
			}
			v, _, err := k.GetStringValue("Layout Id")
			k.Close()
			if err != nil {
				continue
			}
			if n, err := strconv.ParseUint(strings.TrimSpace(v), 16, 16); err == nil {
				layoutIDs[uint16(n)] = strings.ToUpper(klid)
			}
		}
	})
	return layoutIDs[id]
}

// layoutName e o nome traduzido que aparece nas Configuracoes do Windows ("Português (Brasil ABNT2)").
func layoutName(klid string) string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, keyboardLayoutsKey+`\`+klid, registry.QUERY_VALUE)
	if err != nil {
		return klid
	}
	defer k.Close()
	if s, err := k.GetMUIStringValue("Layout Display Name"); err == nil && s != "" {
		return s
	}
	if s, _, err := k.GetStringValue("Layout Text"); err == nil && s != "" {
		return s
	}
	return klid
}
