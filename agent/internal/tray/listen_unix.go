//go:build linux || darwin

package tray

import (
	"errors"
	"net"
	"os"
	"os/user"
	"runtime"
	"strconv"
)

// SocketPath e o socket Unix do canal local (o app usa o mesmo caminho).
func SocketPath() string {
	if p := os.Getenv("EYES_TRAY_SOCKET"); p != "" {
		return p
	}
	if runtime.GOOS == "darwin" {
		return "/var/run/eyes-tray.sock"
	}
	return "/run/eyes-tray.sock"
}

func listen() (net.Listener, error) {
	path := SocketPath()
	_ = os.Remove(path)
	ln, err := net.Listen("unix", path)
	if err != nil {
		return nil, err
	}
	// Qualquer usuario conecta; o usuario e identificado pelas credenciais do par.
	if err := os.Chmod(path, 0o666); err != nil {
		ln.Close()
		return nil, err
	}
	return ln, nil
}

func peerUser(conn net.Conn) (string, error) {
	uc, ok := conn.(*net.UnixConn)
	if !ok {
		return "", errors.New("conexao nao e socket Unix")
	}
	raw, err := uc.SyscallConn()
	if err != nil {
		return "", err
	}
	var uid int = -1
	var cerr error
	err = raw.Control(func(fd uintptr) { uid, cerr = peerUID(int(fd)) })
	if err != nil {
		return "", err
	}
	if cerr != nil {
		return "", cerr
	}
	if uid == 0 {
		return "", errors.New("root nao usa o app de bandeja")
	}
	u, err := user.LookupId(strconv.Itoa(uid))
	if err != nil {
		return "", err
	}
	return u.Username, nil
}
