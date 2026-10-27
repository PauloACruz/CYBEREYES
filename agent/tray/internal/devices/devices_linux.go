//go:build linux

package devices

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Raizes lidas no Linux; os testes apontam para um diretorio temporario.
var (
	procInputDevices = "/proc/bus/input/devices"
	sysUSBDevices    = "/sys/bus/usb/devices"
	sysVideo4Linux   = "/sys/class/video4linux"
)

// List le teclados, mouses e touchpads de /proc/bus/input/devices, as cameras do video4linux e os
// aparelhos USB do sysfs. O Linux nao tem codigo de problema como o Windows: tudo que aparece esta OK.
func List() Snapshot {
	out := []Device{}
	if b, err := os.ReadFile(procInputDevices); err == nil {
		// O touchpad costuma aparecer duas vezes no mesmo dispositivo HID, como "... Mouse" e
		// "... Touchpad": fica uma entrada so, a do touchpad.
		byParent := map[string][]int{}
		for _, d := range parseInputDevices(string(b)) {
			kind := classifyInput(d)
			if kind == "" {
				continue
			}
			id := d.sysfs
			if id == "" {
				id = d.phys + "|" + d.name
			}
			parent := filepath.Dir(filepath.Dir(id))
			if d.sysfs != "" && mergeInput(out, byParent[parent], kind, d.name, "input:"+id) {
				continue
			}
			byParent[parent] = append(byParent[parent], len(out))
			out = append(out, Device{ID: "input:" + id, Kind: kind, Name: d.name, Bus: inputBus(d.bus), OK: true})
		}
	}
	out = append(out, listCameras()...)
	out = append(out, listUSB()...)
	sortDevices(out)
	return Snapshot{Supported: true, Devices: out}
}

// mergeInput junta a entrada a outra do mesmo dispositivo: repetida no tipo, ou o mouse que e a
// emulacao do touchpad. Devolve se juntou.
func mergeInput(out []Device, siblings []int, kind, name, id string) bool {
	for _, i := range siblings {
		a := &out[i]
		switch {
		case a.Kind == kind, a.Kind == KindTouchpad && kind == KindPointer:
			return true
		case a.Kind == KindPointer && kind == KindTouchpad:
			a.Kind, a.Name, a.ID = KindTouchpad, name, id
			return true
		}
	}
	return false
}

func readTrim(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// listCameras pega so o no de captura (index 0) de cada camera: as UVC criam outro no para metadados.
func listCameras() []Device {
	entries, _ := os.ReadDir(sysVideo4Linux)
	seen := map[string]bool{}
	var out []Device
	for _, e := range entries {
		dir := filepath.Join(sysVideo4Linux, e.Name())
		if idx := readTrim(filepath.Join(dir, "index")); idx != "" && idx != "0" {
			continue
		}
		dev, err := filepath.EvalSymlinks(filepath.Join(dir, "device"))
		if err != nil {
			dev = dir
		}
		if seen[dev] {
			continue
		}
		seen[dev] = true
		bus := BusInternal
		if strings.Contains(dev, "/usb") {
			bus = BusUSB
		}
		// O driver UVC repete o nome: "HP 5MP Camera: HP 5MP Camera".
		name := readTrim(filepath.Join(dir, "name"))
		if a, b, ok := strings.Cut(name, ": "); ok && a == b {
			name = a
		}
		if name == "" {
			name = e.Name()
		}
		out = append(out, Device{ID: "v4l:" + dev, Kind: KindCamera, Name: name, Bus: bus, OK: true})
	}
	return out
}

// listUSB lista os aparelhos USB: as entradas "1-2" e "1-2.3"; "usb1" sao os hubs raiz e "1-2:1.0"
// as interfaces. Hubs (classe 09) ficam de fora.
func listUSB() []Device {
	entries, _ := os.ReadDir(sysUSBDevices)
	var out []Device
	for _, e := range entries {
		name := e.Name()
		if strings.Contains(name, ":") || strings.HasPrefix(name, "usb") {
			continue
		}
		dir := filepath.Join(sysUSBDevices, name)
		if readTrim(filepath.Join(dir, "bDeviceClass")) == "09" {
			continue
		}
		vid, pid := readTrim(filepath.Join(dir, "idVendor")), readTrim(filepath.Join(dir, "idProduct"))
		product := readTrim(filepath.Join(dir, "product"))
		if product == "" {
			product = "Dispositivo USB " + vid + ":" + pid
		}
		d := Device{ID: "usb:" + name + ":" + vid + ":" + pid, Kind: KindUSB, Name: product, Bus: BusUSB, OK: true}
		d.Manufacturer = readTrim(filepath.Join(dir, "manufacturer"))
		if vid != "" {
			d.Model = vid + ":" + pid
		}
		out = append(out, d)
	}
	return out
}

func run(name string, args ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).Output()
	if err != nil {
		return ""
	}
	return string(out)
}

// KeyboardLayout tenta o GNOME (o mais usado e o unico confiavel no Wayland), depois o X11
// (setxkbmap) e por ultimo o padrao do sistema (localectl).
func KeyboardLayout() Layout {
	if out := run("gsettings", "get", "org.gnome.desktop.input-sources", "mru-sources"); out != "" {
		if l, ok := gnomeLayout(parseGsettingsSources(out), parseGsettingsSources(run("gsettings", "get", "org.gnome.desktop.input-sources", "sources"))); ok {
			return l
		}
	}
	if out := run("gsettings", "get", "org.gnome.desktop.input-sources", "sources"); out != "" {
		if l, ok := gnomeLayout(nil, parseGsettingsSources(out)); ok {
			return l
		}
	}
	if os.Getenv("WAYLAND_DISPLAY") == "" {
		if kv := parseKeyValueLines(run("setxkbmap", "-query")); kv["layout"] != "" {
			id := xkbID(kv["layout"], kv["variant"])
			return Layout{ID: id, Name: xkbName(id)}
		}
	}
	if kv := parseKeyValueLines(run("localectl", "status")); kv["x11 layout"] != "" {
		id := xkbID(kv["x11 layout"], kv["x11 variant"])
		return Layout{ID: id, Name: xkbName(id)}
	}
	return Layout{Error: "Não foi possível ler o layout de teclado do sistema."}
}

// gnomeLayout usa o primeiro da lista dos usados por ultimo (o ativo) e, sem ela, o primeiro configurado.
func gnomeLayout(mru, sources []string) (Layout, bool) {
	active := ""
	if len(mru) > 0 {
		active = mru[0]
	} else if len(sources) > 0 {
		active = sources[0]
	}
	if active == "" {
		return Layout{}, false
	}
	l := Layout{ID: active, Name: xkbName(active)}
	for _, s := range sources {
		if n := xkbName(s); s != active && !containsString(l.Installed, n) {
			l.Installed = append(l.Installed, n)
		}
	}
	return l, true
}
