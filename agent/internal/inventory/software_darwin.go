//go:build darwin

package inventory

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/execx"
)

// collectSoftware usa o system_profiler (lento, mas completo); se falhar ou estourar o tempo,
// le o Info.plist dos apps em /Applications e nas pastas Applications dos usuarios.
func collectSoftware(ctx context.Context) ([]Software, error) {
	timeout := 2 * time.Minute
	if dl, ok := ctx.Deadline(); ok {
		// Reserva alguns segundos para a varredura de apps caso o system_profiler nao termine.
		if left := time.Until(dl) - 10*time.Second; left < timeout {
			timeout = left
		}
	}
	if timeout > 5*time.Second {
		res := execx.Run(ctx, execx.Spec{Path: "/usr/sbin/system_profiler", Args: []string{"-json", "SPApplicationsDataType"}, Timeout: timeout})
		if res.Err == nil && !res.TimedOut {
			if list, err := parseMacApps([]byte(res.Stdout)); err == nil && len(list) > 0 {
				return list, nil
			}
		}
	}
	return scanApplications(ctx), nil
}

func scanApplications(ctx context.Context) []Software {
	var dirs []string
	dirs = append(dirs, "/Applications", "/Applications/Utilities")
	if homes, err := os.ReadDir("/Users"); err == nil {
		for _, h := range homes {
			if h.IsDir() && h.Name() != "Shared" {
				dirs = append(dirs, filepath.Join("/Users", h.Name(), "Applications"))
			}
		}
	}
	var list []Software
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if ctx.Err() != nil {
				return list
			}
			if !strings.HasSuffix(e.Name(), ".app") {
				continue
			}
			app := filepath.Join(dir, e.Name())
			if s, ok := readApp(ctx, app); ok {
				list = append(list, s)
			}
		}
	}
	return list
}

func readApp(ctx context.Context, app string) (Software, bool) {
	plist := filepath.Join(app, "Contents", "Info.plist")
	data, err := os.ReadFile(plist)
	if err != nil {
		return Software{}, false
	}
	if bytes.HasPrefix(data, []byte("bplist")) {
		res := execx.Run(ctx, execx.Spec{Path: "/usr/bin/plutil", Args: []string{"-convert", "xml1", "-o", "-", plist}, Timeout: 5 * time.Second})
		if res.Err != nil || res.TimedOut {
			return Software{}, false
		}
		data = []byte(res.Stdout)
	}
	kv := parsePlistStrings(data)
	name := kv["CFBundleDisplayName"]
	if name == "" {
		name = kv["CFBundleName"]
	}
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(app), ".app")
	}
	version := kv["CFBundleShortVersionString"]
	if version == "" {
		version = kv["CFBundleVersion"]
	}
	s := Software{Name: name, Version: version, Source: "app", Location: app}
	if st, err := os.Stat(app); err == nil {
		s.InstallDate = st.ModTime().Format(dateLayout)
	}
	if strings.HasPrefix(kv["CFBundleIdentifier"], "com.apple.") {
		s.Publisher = "Apple"
	}
	return s, true
}
