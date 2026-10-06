//go:build !windows

package files

import (
	"bufio"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// Dirs resolve as pastas do usuario; no Linux segue o ~/.config/user-dirs.dirs (pastas traduzidas, como
// "Area de Trabalho").
func Dirs(u User) (Home, error) {
	if u.Name == "" {
		return Home{}, ErrNoUser
	}
	acc, err := user.Lookup(u.Name)
	if err != nil {
		return Home{}, err
	}
	h := Home{Home: acc.HomeDir, Desktop: filepath.Join(acc.HomeDir, "Desktop"), Downloads: filepath.Join(acc.HomeDir, "Downloads"), Separator: "/"}
	if runtime.GOOS == "linux" {
		dirs := userDirs(acc.HomeDir)
		if d := dirs["XDG_DESKTOP_DIR"]; d != "" {
			h.Desktop = d
		}
		if d := dirs["XDG_DOWNLOAD_DIR"]; d != "" {
			h.Downloads = d
		}
	}
	if !isDir(h.Desktop) {
		h.Desktop = h.Home
	}
	if !isDir(h.Downloads) {
		h.Downloads = h.Home
	}
	return h, nil
}

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

// userDirs le as linhas XDG_*_DIR="$HOME/..." do usuario.
func userDirs(home string) map[string]string {
	out := map[string]string{}
	f, err := os.Open(filepath.Join(home, ".config", "user-dirs.dirs"))
	if err != nil {
		return out
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		k, v, ok := strings.Cut(line, "=")
		if !ok || strings.HasPrefix(line, "#") {
			continue
		}
		v = strings.Trim(v, `"`)
		v = strings.Replace(v, "$HOME", home, 1)
		if filepath.IsAbs(v) {
			out[k] = filepath.Clean(v)
		}
	}
	return out
}

// owner devolve uid e gid do usuario para entregar a ele o que o servico (root) criar.
func owner(u User) (int, int, bool) {
	if u.Name == "" {
		return 0, 0, false
	}
	acc, err := user.Lookup(u.Name)
	if err != nil {
		return 0, 0, false
	}
	uid, err1 := strconv.Atoi(acc.Uid)
	gid, err2 := strconv.Atoi(acc.Gid)
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	return uid, gid, true
}

// giveTo passa o arquivo ou a pasta criada para o usuario da sessao (sem efeito quando o EYES nao e root).
func giveTo(u User, p string) {
	if os.Geteuid() != 0 {
		return
	}
	if uid, gid, ok := owner(u); ok {
		_ = os.Lchown(p, uid, gid)
	}
}

func hidden(name string, _ os.FileInfo) bool { return strings.HasPrefix(name, ".") }
