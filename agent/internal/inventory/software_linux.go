//go:build linux

package inventory

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/execx"
)

// collectSoftware junta os pacotes do dpkg, rpm, pacman, snap e flatpak (os que existirem).
func collectSoftware(ctx context.Context) ([]Software, error) {
	var list []Software
	var errs []error
	found := false

	if _, err := exec.LookPath("dpkg-query"); err == nil {
		found = true
		out, err := runC(ctx, 60*time.Second, "dpkg-query", "-W", "-f="+dpkgFormat)
		if err != nil {
			errs = append(errs, err)
		}
		for _, e := range parseDpkg(out) {
			e.InstallDate = dpkgInstallDate(e.Name, e.Arch)
			list = append(list, e.Software)
		}
	}
	if _, err := exec.LookPath("rpm"); err == nil {
		found = true
		out, err := runC(ctx, 60*time.Second, "rpm", "-qa", "--queryformat", rpmFormat)
		if err != nil {
			errs = append(errs, err)
		}
		list = append(list, parseRpm(out, rpmRemoveCmd())...)
	}
	if _, err := exec.LookPath("pacman"); err == nil {
		found = true
		out, err := runC(ctx, 60*time.Second, "pacman", "-Qi")
		if err != nil {
			errs = append(errs, err)
		}
		list = append(list, parsePacman(out)...)
	}
	if _, err := exec.LookPath("snap"); err == nil {
		if out, err := runC(ctx, 20*time.Second, "snap", "list"); err == nil {
			list = append(list, parseSnap(out)...)
		}
	}
	if _, err := exec.LookPath("flatpak"); err == nil {
		if out, err := runC(ctx, 20*time.Second, "flatpak", "list", "--app", "--columns=name,application,version,origin"); err == nil {
			list = append(list, parseFlatpak(out)...)
		}
	}
	if !found && len(list) == 0 {
		return nil, errors.New("nenhum gerenciador de pacotes conhecido (dpkg, rpm, pacman)")
	}
	return list, joinErrs(errs)
}

// runC executa com LC_ALL=C (datas e textos previsiveis) e devolve a saida padrao.
func runC(ctx context.Context, timeout time.Duration, name string, args ...string) (string, error) {
	res := execx.Run(ctx, execx.Spec{Path: name, Args: args, Timeout: timeout, Env: []string{"LC_ALL=C", "LANG=C"}})
	if res.Err != nil {
		return "", res.Err
	}
	if res.TimedOut {
		return res.Stdout, errors.New(name + ": tempo limite excedido")
	}
	return res.Stdout, nil
}

// dpkgInstallDate usa a data do arquivo .list do pacote como data de instalacao.
func dpkgInstallDate(name, arch string) string {
	for _, f := range []string{name + ".list", name + ":" + arch + ".list"} {
		if st, err := os.Stat(filepath.Join("/var/lib/dpkg/info", f)); err == nil {
			return st.ModTime().Format(dateLayout)
		}
	}
	return ""
}

func rpmRemoveCmd() string {
	for _, c := range []struct{ bin, cmd string }{{"dnf", "dnf remove -y"}, {"yum", "yum remove -y"}, {"zypper", "zypper -n remove"}} {
		if _, err := exec.LookPath(c.bin); err == nil {
			return c.cmd
		}
	}
	return "rpm -e"
}
