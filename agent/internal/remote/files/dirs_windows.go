//go:build windows

package files

import (
	"os"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
)

// Dirs resolve as pastas conhecidas do usuario da sessao pelo token dele (Area de Trabalho e Downloads podem
// estar redirecionadas, por exemplo para o OneDrive).
func Dirs(u User) (Home, error) {
	if u.Name == "" {
		return Home{}, ErrNoUser
	}
	var tok windows.Token
	if err := windows.WTSQueryUserToken(u.Session, &tok); err != nil {
		return Home{}, err
	}
	defer tok.Close()
	profile, err := tok.KnownFolderPath(windows.FOLDERID_Profile, 0)
	if err != nil {
		return Home{}, err
	}
	h := Home{Home: profile, Desktop: profile, Downloads: profile, Separator: `\`}
	if d, err := tok.KnownFolderPath(windows.FOLDERID_Desktop, 0); err == nil {
		h.Desktop = d
	}
	if d, err := tok.KnownFolderPath(windows.FOLDERID_Downloads, 0); err == nil {
		h.Downloads = d
	}
	return h, nil
}

// giveTo: no Windows o arquivo herda as permissoes da pasta do usuario.
func giveTo(User, string) {}

func hidden(name string, info os.FileInfo) bool {
	if d, ok := info.Sys().(*syscall.Win32FileAttributeData); ok {
		return d.FileAttributes&windows.FILE_ATTRIBUTE_HIDDEN != 0
	}
	return strings.HasPrefix(name, ".")
}
