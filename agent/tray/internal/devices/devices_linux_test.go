//go:build linux

package devices

import (
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestListLinux(t *testing.T) {
	root := t.TempDir()
	procInputDevices = filepath.Join(root, "proc-input")
	sysUSBDevices = filepath.Join(root, "usb")
	sysVideo4Linux = filepath.Join(root, "v4l")
	t.Cleanup(func() {
		procInputDevices, sysUSBDevices, sysVideo4Linux = "/proc/bus/input/devices", "/sys/bus/usb/devices", "/sys/class/video4linux"
	})

	write(t, procInputDevices, procSample)
	// Hub raiz, hub externo, interface e dois aparelhos (um sem nome de produto).
	write(t, filepath.Join(sysUSBDevices, "usb1", "bDeviceClass"), "09\n")
	write(t, filepath.Join(sysUSBDevices, "1-1", "bDeviceClass"), "09\n")
	write(t, filepath.Join(sysUSBDevices, "1-2:1.0", "bInterfaceClass"), "03\n")
	write(t, filepath.Join(sysUSBDevices, "1-2", "bDeviceClass"), "00\n")
	write(t, filepath.Join(sysUSBDevices, "1-2", "idVendor"), "046d\n")
	write(t, filepath.Join(sysUSBDevices, "1-2", "idProduct"), "c52b\n")
	write(t, filepath.Join(sysUSBDevices, "1-2", "product"), "USB Receiver\n")
	write(t, filepath.Join(sysUSBDevices, "1-2", "manufacturer"), "Logitech\n")
	write(t, filepath.Join(sysUSBDevices, "1-1.4", "bDeviceClass"), "00\n")
	write(t, filepath.Join(sysUSBDevices, "1-1.4", "idVendor"), "0781\n")
	write(t, filepath.Join(sysUSBDevices, "1-1.4", "idProduct"), "5581\n")
	// Camera com o no de captura e o de metadados.
	write(t, filepath.Join(sysVideo4Linux, "video0", "name"), "Integrated Camera: Integrated Camera\n")
	write(t, filepath.Join(sysVideo4Linux, "video0", "index"), "0\n")
	write(t, filepath.Join(sysVideo4Linux, "video1", "name"), "Integrated Camera: Integrated C\n")
	write(t, filepath.Join(sysVideo4Linux, "video1", "index"), "1\n")

	s := List()
	if !s.Supported {
		t.Fatal("Linux deve ser suportado")
	}
	count := map[string]int{}
	names := map[string]Device{}
	for _, d := range s.Devices {
		count[d.Kind]++
		names[d.Name] = d
	}
	if count[KindKeyboard] != 1 || count[KindTouchpad] != 1 || count[KindPointer] != 1 || count[KindCamera] != 1 || count[KindUSB] != 2 {
		t.Fatalf("contagem por tipo: %v (%+v)", count, s.Devices)
	}
	if d := names["USB Receiver"]; d.Manufacturer != "Logitech" || d.Model != "046d:c52b" || d.Bus != BusUSB {
		t.Fatalf("receptor: %+v", d)
	}
	if _, ok := names["SYNA7DB5:00 06CB:7E7E Touchpad"]; !ok {
		t.Fatalf("o touchpad deve ficar uma vez so, com o nome do touchpad: %+v", s.Devices)
	}
	if _, ok := names["Integrated Camera"]; !ok {
		t.Fatalf("nome repetido da camera: %+v", s.Devices)
	}
	if _, ok := names["Dispositivo USB 0781:5581"]; !ok {
		t.Fatalf("aparelho sem nome de produto deve aparecer pelo VID:PID: %+v", s.Devices)
	}
}

func TestGnomeLayout(t *testing.T) {
	l, ok := gnomeLayout([]string{"us(intl)", "br"}, []string{"br", "us(intl)"})
	if !ok || l.ID != "us(intl)" || l.Name != "Inglês (EUA, internacional com teclas mortas)" {
		t.Fatalf("layout ativo: %+v", l)
	}
	if len(l.Installed) != 1 || l.Installed[0] != "Português (Brasil ABNT2)" {
		t.Fatalf("instalados: %v", l.Installed)
	}
	if _, ok := gnomeLayout(nil, nil); ok {
		t.Fatal("sem fontes nao ha layout")
	}
}
