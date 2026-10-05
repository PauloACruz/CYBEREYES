package remote

import (
	"bytes"
	"net"
	"testing"
	"time"
)

func TestMagicPacketAndSend(t *testing.T) {
	mac, _ := net.ParseMAC("AA:BB:CC:DD:EE:FF")
	p := MagicPacket(mac)
	if len(p) != 102 || !bytes.Equal(p[:6], bytes.Repeat([]byte{0xFF}, 6)) || !bytes.Equal(p[96:], mac) {
		t.Fatalf("pacote magico: %x", p)
	}

	// Recebe no lugar de um broadcast (127.0.0.1 numa porta alta).
	ln, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	old := wolPorts
	wolPorts = []int{ln.LocalAddr().(*net.UDPAddr).Port}
	t.Cleanup(func() { wolPorts = old })
	if err := sendWake([]string{"aa:bb:cc:dd:ee:ff"}, []string{"127.0.0.1"}); err != nil {
		t.Fatal(err)
	}
	_ = ln.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 200)
	n, _, err := ln.ReadFrom(buf)
	if err != nil || !bytes.Equal(buf[:n], p) {
		t.Fatalf("recebido %d bytes: %v", n, err)
	}

	for _, c := range [][2][]string{{{"nao-e-mac"}, {"127.0.0.1"}}, {{"aa:bb:cc:dd:ee:ff"}, {"::1"}}, {{}, {"127.0.0.1"}}} {
		if err := sendWake(c[0], c[1]); err == nil {
			t.Errorf("aceitou %v", c)
		}
	}
}
