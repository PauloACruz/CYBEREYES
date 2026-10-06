//go:build !windows

package remote

import (
	"context"
	"net"
	"syscall"
)

// sendBroadcast envia os pacotes por UDP com SO_BROADCAST ligado.
func sendBroadcast(addr string, packets [][]byte) error {
	lc := net.ListenConfig{Control: func(_, _ string, c syscall.RawConn) error {
		var serr error
		if err := c.Control(func(fd uintptr) { serr = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_BROADCAST, 1) }); err != nil {
			return err
		}
		return serr
	}}
	conn, err := lc.ListenPacket(context.Background(), "udp4", ":0")
	if err != nil {
		return err
	}
	defer conn.Close()
	to, err := net.ResolveUDPAddr("udp4", addr)
	if err != nil {
		return err
	}
	for _, p := range packets {
		if _, err := conn.WriteTo(p, to); err != nil {
			return err
		}
	}
	return nil
}
