package remote

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strconv"

	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// wolPorts sao as portas do pacote magico (contrato, secao 3; trocadas nos testes).
var wolPorts = []int{7, 9}

// MagicPacket monta o pacote magico: 6 bytes 0xFF e 16 repeticoes do MAC.
func MagicPacket(mac net.HardwareAddr) []byte {
	p := make([]byte, 0, 102)
	for i := 0; i < 6; i++ {
		p = append(p, 0xFF)
	}
	for i := 0; i < 16; i++ {
		p = append(p, mac...)
	}
	return p
}

// wol envia o pacote magico de cada MAC para cada endereco de broadcast pedido pela API.
func wol(_ context.Context, req rpc.Request) any {
	p := req.Payload()
	var macs, broadcasts []string
	if json.Unmarshal([]byte(p.Str("macs")), &macs) != nil || json.Unmarshal([]byte(p.Str("broadcast")), &broadcasts) != nil {
		return "error: pedido invalido"
	}
	if err := sendWake(macs, broadcasts); err != nil {
		return "error: " + err.Error()
	}
	return "ok"
}

func sendWake(macs, broadcasts []string) error {
	if len(macs) == 0 || len(broadcasts) == 0 || len(macs) > 32 || len(broadcasts) > 32 {
		return errors.New("informe de 1 a 32 MACs e enderecos")
	}
	packets := make([][]byte, 0, len(macs))
	for _, m := range macs {
		hw, err := net.ParseMAC(m)
		if err != nil || len(hw) != 6 {
			return fmt.Errorf("MAC invalido: %q", m)
		}
		packets = append(packets, MagicPacket(hw))
	}
	sent := 0
	var last error
	for _, b := range broadcasts {
		ip := net.ParseIP(b).To4()
		if ip == nil {
			return fmt.Errorf("endereco invalido: %q", b)
		}
		for _, port := range wolPorts {
			if err := sendBroadcast(net.JoinHostPort(ip.String(), strconv.Itoa(port)), packets); err != nil {
				last = err
				continue
			}
			sent++
		}
	}
	if sent == 0 {
		return fmt.Errorf("nenhum pacote enviado: %w", last)
	}
	return nil
}
