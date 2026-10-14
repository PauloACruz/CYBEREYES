//go:build windows

package inventory

import (
	"context"
	"strings"

	"golang.org/x/sys/windows/registry"

	"github.com/pauloacruz/cybereyes/agent/internal/sysinfo"
)

const uninstallPath = `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`

// collectSoftware le as chaves Uninstall do registro: 64 bits, 32 bits (WOW6432Node) e as
// de cada usuario com perfil carregado em HKEY_USERS.
func collectSoftware(ctx context.Context) ([]Software, error) {
	var list []Software
	var errs []error
	for _, view := range []uint32{registry.WOW64_64KEY, registry.WOW64_32KEY} {
		items, err := readUninstall(ctx, registry.LOCAL_MACHINE, uninstallPath, view, false, machineKeyPrefix(view))
		if err != nil {
			errs = append(errs, err)
		}
		list = append(list, items...)
	}
	if users, err := registry.USERS.ReadSubKeyNames(-1); err == nil {
		for _, sid := range users {
			if !strings.HasPrefix(sid, "S-1-5-21-") || strings.HasSuffix(sid, "_Classes") {
				continue
			}
			items, _ := readUninstall(ctx, registry.USERS, sid+`\`+uninstallPath, 0, true, `HKU\`+sid+`\`+uninstallPath)
			list = append(list, items...)
		}
	}
	return list, joinErrs(errs)
}

// machineKeyPrefix devolve a chave Uninstall no formato do console: a visao de 32 bits fica
// explicita em WOW6432Node (o agente abre esses caminhos sempre na visao de 64 bits).
func machineKeyPrefix(view uint32) string {
	if view == registry.WOW64_32KEY {
		return `HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`
	}
	return `HKLM\` + uninstallPath
}

func readUninstall(ctx context.Context, root registry.Key, path string, view uint32, user bool, keyPrefix string) ([]Software, error) {
	k, err := registry.OpenKey(root, path, registry.ENUMERATE_SUB_KEYS|registry.QUERY_VALUE|view)
	if err != nil {
		return nil, err
	}
	defer k.Close()
	names, err := k.ReadSubKeyNames(-1)
	if err != nil {
		return nil, err
	}
	var list []Software
	for _, name := range names {
		if ctx.Err() != nil {
			return list, ctx.Err()
		}
		sk, err := registry.OpenKey(k, name, registry.QUERY_VALUE|view)
		if err != nil {
			continue
		}
		if s, ok := uninstallEntry(sk, user); ok {
			s.Key = keyPrefix + `\` + name
			list = append(list, s)
		}
		sk.Close()
	}
	return list, nil
}

func uninstallEntry(k registry.Key, user bool) (Software, bool) {
	str := func(n string) string {
		v, _, err := k.GetStringValue(n)
		if err != nil {
			return ""
		}
		return v
	}
	num := func(n string) uint64 {
		v, _, err := k.GetIntegerValue(n)
		if err != nil {
			return 0
		}
		return v
	}
	name := str("DisplayName")
	if strings.TrimSpace(name) == "" || num("SystemComponent") == 1 || str("ParentKeyName") != "" {
		return Software{}, false
	}
	switch strings.ToLower(str("ReleaseType")) {
	case "update", "hotfix", "security update", "service pack":
		return Software{}, false
	}
	s := Software{
		Name:        name,
		Version:     str("DisplayVersion"),
		Publisher:   str("Publisher"),
		InstallDate: formatInstallDate(str("InstallDate")),
		Location:    strings.Trim(str("InstallLocation"), `"`),
		Uninstall:   str("UninstallString"),
		Source:      "registry",
	}
	if s.Uninstall == "" {
		s.Uninstall = str("QuietUninstallString")
	}
	if num("WindowsInstaller") == 1 {
		s.Source = "msi"
	}
	if user {
		s.Source = "user"
	}
	if kb := num("EstimatedSize"); kb > 0 {
		s.Size = sysinfo.FormatBytes(kb * 1024)
	}
	return s, true
}
