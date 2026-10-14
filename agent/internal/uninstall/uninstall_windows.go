//go:build windows

package uninstall

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"

	"github.com/pauloacruz/cybereyes/agent/internal/config"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/execx"
	"github.com/pauloacruz/cybereyes/agent/internal/winsys"
)

// Register registra softwareuninstall e softwarecleanup.
func Register(e *env.Env) error {
	newService(e, &winSystem{}).register(e.Reg)
	return nil
}

type winSystem struct{}

// Limites da leitura de disco.
const (
	maxSizeEntries = 50000
	maxTaskFile    = 1 << 20
	maxNSISProbe   = 4 << 20
	// childGrace e a espera pelos processos abertos pelo desinstalador depois que ele termina.
	childGrace = 10 * time.Minute
)

func getenv(name, def string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return def
}

func (w *winSystem) SystemRoot() string { return getenv("SystemRoot", `C:\Windows`) }

func (w *winSystem) Layout() Layout {
	pd := getenv("ProgramData", `C:\ProgramData`)
	l := Layout{
		SystemRoot:    w.SystemRoot(),
		ProgramData:   pd,
		StartMenu:     filepath.Join(pd, `Microsoft\Windows\Start Menu\Programs`),
		PublicDesktop: filepath.Join(getenv("PUBLIC", `C:\Users\Public`), "Desktop"),
		Own:           []string{config.InstallDir(), config.DataDir()},
	}
	for _, v := range []string{"ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"} {
		if p := os.Getenv(v); p != "" {
			l.ProgramFiles = append(l.ProgramFiles, p)
		}
	}
	for _, v := range []string{"CommonProgramW6432", "CommonProgramFiles", "CommonProgramFiles(x86)"} {
		if p := os.Getenv(v); p != "" {
			l.CommonFiles = append(l.CommonFiles, p)
		}
	}
	l.Profiles = profiles()
	if sids, err := registry.USERS.ReadSubKeyNames(-1); err == nil {
		for _, sid := range sids {
			if strings.HasPrefix(sid, "S-1-5-21-") && !strings.HasSuffix(sid, "_Classes") {
				l.UserHives = append(l.UserHives, sid)
			}
		}
	}
	return l
}

// profiles le as pastas dos perfis de usuarios (contas locais e de dominio) no ProfileList.
func profiles() []string {
	const list = `SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList`
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, list, registry.ENUMERATE_SUB_KEYS|registry.WOW64_64KEY)
	if err != nil {
		return nil
	}
	defer k.Close()
	sids, _ := k.ReadSubKeyNames(-1)
	var out []string
	for _, sid := range sids {
		if !strings.HasPrefix(sid, "S-1-5-21-") {
			continue
		}
		sk, err := registry.OpenKey(k, sid, registry.QUERY_VALUE|registry.WOW64_64KEY)
		if err != nil {
			continue
		}
		p, _, err := sk.GetStringValue("ProfileImagePath")
		sk.Close()
		if err != nil {
			continue
		}
		if exp, err := registry.ExpandString(p); err == nil {
			p = exp
		}
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			out = append(out, p)
		}
	}
	return out
}

func isReparse(info fs.FileInfo) bool {
	if a, ok := info.Sys().(*syscall.Win32FileAttributeData); ok {
		return a.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0
	}
	return info.Mode()&(fs.ModeSymlink|fs.ModeIrregular) != 0
}

func (w *winSystem) ReadDir(dir string) ([]dirEntry, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]dirEntry, 0, len(entries))
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, dirEntry{Name: e.Name(), Dir: info.IsDir(), Link: isReparse(info)})
	}
	return out, nil
}

func (w *winSystem) IsDir(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.IsDir() && !isReparse(info)
}

func (w *winSystem) DirSize(dir string) (uint64, int) {
	var size uint64
	files, seen := 0, 0
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if seen++; seen > maxSizeEntries {
			return filepath.SkipAll
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		if isReparse(info) {
			if d.IsDir() && p != dir {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.IsDir() {
			files++
			size += uint64(info.Size())
		}
		return nil
	})
	return size, files
}

// openKey abre a chave na visao de 64 bits (os caminhos de 32 bits trazem WOW6432Node).
func openKey(path string, access uint32) (registry.Key, error) {
	p, err := winsys.ParseRegPath(path)
	if err != nil {
		return 0, err
	}
	var root registry.Key
	switch p.Root {
	case winsys.HKLM:
		root = registry.LOCAL_MACHINE
	case winsys.HKU:
		root = registry.USERS
	default:
		return 0, fmt.Errorf("colmeia nao suportada: %s", p.Root)
	}
	return registry.OpenKey(root, p.Sub, access|registry.WOW64_64KEY)
}

func (w *winSystem) SubKeys(key string) ([]string, error) {
	k, err := openKey(key, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return nil, err
	}
	defer k.Close()
	return k.ReadSubKeyNames(-1)
}

func (w *winSystem) KeyExists(key string) bool {
	k, err := openKey(key, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	k.Close()
	return true
}

func (w *winSystem) StringValues(key string) (map[string]string, error) {
	k, err := openKey(key, registry.QUERY_VALUE)
	if err != nil {
		return nil, err
	}
	defer k.Close()
	names, err := k.ReadValueNames(-1)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, n := range names {
		if v, _, err := k.GetStringValue(n); err == nil {
			out[n] = expand(v)
		}
	}
	return out, nil
}

func expand(s string) string {
	if strings.Contains(s, "%") {
		if exp, err := registry.ExpandString(s); err == nil {
			return exp
		}
	}
	return s
}

// Services lista os servicos Win32 (sem drivers) com o caminho do executavel.
func (w *winSystem) Services() []namedImage {
	const root = `HKLM\SYSTEM\CurrentControlSet\Services`
	k, err := openKey(root, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return nil
	}
	defer k.Close()
	names, _ := k.ReadSubKeyNames(-1)
	var out []namedImage
	for _, n := range names {
		sk, err := registry.OpenKey(k, n, registry.QUERY_VALUE|registry.WOW64_64KEY)
		if err != nil {
			continue
		}
		typ, _, _ := sk.GetIntegerValue("Type")
		img, _, err := sk.GetStringValue("ImagePath")
		sk.Close()
		if err != nil || typ&0x30 == 0 {
			continue
		}
		out = append(out, namedImage{Name: n, Image: expand(img)})
	}
	return out
}

var taskCommandRe = regexp.MustCompile(`(?s)<Command>(.*?)</Command>`)

// Tasks le as tarefas agendadas (menos as da Microsoft) com o comando de cada uma.
func (w *winSystem) Tasks() []namedImage {
	dir := filepath.Join(w.SystemRoot(), `System32\Tasks`)
	var out []namedImage
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(dir, p)
		if d.IsDir() {
			if strings.EqualFold(rel, "Microsoft") {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := d.Info()
		if err != nil || info.Size() > maxTaskFile {
			return nil
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return nil
		}
		m := taskCommandRe.FindStringSubmatch(decodeText(data))
		if m == nil {
			return nil
		}
		out = append(out, namedImage{Name: `\` + rel, Image: expand(strings.TrimSpace(xmlUnescape(m[1])))})
		return nil
	})
	return out
}

// decodeText decodifica UTF-16 (com BOM, como o Agendador grava) ou devolve o texto como esta.
func decodeText(b []byte) string {
	if len(b) >= 2 && b[0] == 0xFF && b[1] == 0xFE {
		u := make([]uint16, 0, len(b)/2)
		for i := 2; i+1 < len(b); i += 2 {
			u = append(u, uint16(b[i])|uint16(b[i+1])<<8)
		}
		return string(utf16.Decode(u))
	}
	return string(bytes.TrimPrefix(b, []byte{0xEF, 0xBB, 0xBF}))
}

func xmlUnescape(s string) string {
	return strings.NewReplacer("&quot;", `"`, "&apos;", "'", "&lt;", "<", "&gt;", ">", "&amp;", "&").Replace(s)
}

// uninstallRoots sao as chaves Uninstall da maquina (64 e 32 bits) e de cada usuario.
func uninstallRoots() []string {
	out := []string{`HKLM\SOFTWARE\` + uninstallSub, `HKLM\SOFTWARE\WOW6432Node\` + uninstallSub}
	if sids, err := registry.USERS.ReadSubKeyNames(-1); err == nil {
		for _, sid := range sids {
			if strings.HasPrefix(sid, "S-1-5-21-") && !strings.HasSuffix(sid, "_Classes") {
				out = append(out, `HKU\`+sid+`\Software\`+uninstallSub)
			}
		}
	}
	return out
}

func (w *winSystem) Find(key, name, version string) (Entry, bool) {
	if key != "" {
		e, err := readEntry(key)
		return e, err == nil
	}
	for _, root := range uninstallRoots() {
		subs, err := w.SubKeys(root)
		if err != nil {
			continue
		}
		for _, sub := range subs {
			e, err := readEntry(root + `\` + sub)
			if err != nil || !strings.EqualFold(strings.TrimSpace(e.Name), name) {
				continue
			}
			if version == "" || strings.EqualFold(strings.TrimSpace(e.Version), version) {
				return e, true
			}
		}
	}
	return Entry{}, false
}

func readEntry(key string) (Entry, error) {
	k, err := openKey(key, registry.QUERY_VALUE)
	if err != nil {
		return Entry{}, err
	}
	defer k.Close()
	str := func(n string) string {
		v, _, err := k.GetStringValue(n)
		if err != nil {
			return ""
		}
		return strings.TrimSpace(expand(v))
	}
	num := func(n string) uint64 {
		v, _, _ := k.GetIntegerValue(n)
		return v
	}
	e := Entry{
		Key:                  key,
		Name:                 str("DisplayName"),
		Version:              str("DisplayVersion"),
		Publisher:            str("Publisher"),
		InstallLocation:      strings.Trim(str("InstallLocation"), `"`),
		DisplayIcon:          strings.Trim(str("DisplayIcon"), `"`),
		UninstallString:      str("UninstallString"),
		QuietUninstallString: str("QuietUninstallString"),
		WindowsInstaller:     num("WindowsInstaller") == 1,
		InnoAppPath:          str("Inno Setup: App Path"),
		Bundle:               str("BundleCachePath") != "" || str("BundleProviderKey") != "",
	}
	if e.Name == "" {
		return Entry{}, errors.New("entrada sem nome")
	}
	if exe, _ := splitCommand(e.UninstallString); exe != "" && !isMsiexec(exe) {
		e.NSIS = looksNSIS(exe)
	}
	return e, nil
}

// looksNSIS procura a marca do Nullsoft no inicio do executavel.
func looksNSIS(exe string) bool {
	f, err := os.Open(exe)
	if err != nil {
		return false
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxNSISProbe))
	if err != nil {
		return false
	}
	return bytes.Contains(data, []byte("Nullsoft")) || bytes.Contains(data, []byte("NullsoftInst"))
}

func (w *winSystem) RestorePoint(ctx context.Context, description string) (string, error) {
	cmd := "$ErrorActionPreference='Stop';Checkpoint-Computer -Description " + psQuote(description) + " -RestorePointType APPLICATION_UNINSTALL"
	res := execx.Command(ctx, "powershell", cmd, restorePointLimit, false)
	out := strings.TrimSpace(res.Combined())
	if res.TimedOut {
		return out, errors.New("tempo esgotado")
	}
	if res.Err != nil || res.ExitCode != 0 {
		if out == "" {
			out = fmt.Sprintf("codigo %d", res.ExitCode)
		}
		return "", errors.New(clip(out, 500))
	}
	return out, nil
}

func psQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

// jobAccounting e JOBOBJECT_BASIC_ACCOUNTING_INFORMATION.
type jobAccounting struct {
	TotalUserTime             int64
	TotalKernelTime           int64
	ThisPeriodTotalUserTime   int64
	ThisPeriodTotalKernelTime int64
	TotalPageFaultCount       uint32
	TotalProcesses            uint32
	ActiveProcesses           uint32
	TotalTerminatedProcesses  uint32
}

// Run inicia o desinstalador suspenso dentro de um Job Object e espera ate o job ficar vazio:
// muitos desinstaladores (NSIS, Inno Setup) se copiam para a pasta temporaria, abrem a copia e
// terminam na hora.
func (w *winSystem) Run(ctx context.Context, cmdLine string, timeout time.Duration) runResult {
	start := time.Now()
	res := runResult{}
	defer func() { res.Elapsed = time.Since(start) }()
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		res.Err = err
		return res
	}
	defer windows.CloseHandle(job)
	line, err := windows.UTF16PtrFromString(cmdLine)
	if err != nil {
		res.Err = err
		return res
	}
	si := windows.StartupInfo{Flags: windows.STARTF_USESHOWWINDOW, ShowWindow: windows.SW_HIDE}
	si.Cb = uint32(unsafe.Sizeof(si))
	var pi windows.ProcessInformation
	dir, _ := windows.UTF16PtrFromString(w.SystemRoot())
	flags := uint32(windows.CREATE_SUSPENDED | windows.CREATE_NO_WINDOW | windows.CREATE_UNICODE_ENVIRONMENT)
	if err := windows.CreateProcess(nil, line, nil, nil, false, flags, nil, dir, &si, &pi); err != nil {
		res.Err = err
		return res
	}
	defer windows.CloseHandle(pi.Process)
	defer windows.CloseHandle(pi.Thread)
	if err := windows.AssignProcessToJobObject(job, pi.Process); err != nil {
		// Sem job, espera so o processo principal.
		_, _ = windows.ResumeThread(pi.Thread)
		return w.waitProcess(ctx, pi.Process, timeout, res)
	}
	_, _ = windows.ResumeThread(pi.Thread)
	deadline := start.Add(timeout)
	mainDone := false
	tick := time.NewTicker(500 * time.Millisecond)
	defer tick.Stop()
	for {
		var info jobAccounting
		if err := windows.QueryInformationJobObject(job, windows.JobObjectBasicAccountingInformation,
			uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)), nil); err != nil || info.ActiveProcesses == 0 {
			break
		}
		// Terminado o processo principal, os filhos tem um prazo menor: alguns desinstaladores abrem o
		// navegador ou uma pesquisa no fim e o job nunca esvaziaria.
		if !mainDone {
			if ev, _ := windows.WaitForSingleObject(pi.Process, 0); ev == windows.WAIT_OBJECT_0 {
				mainDone = true
				if d := time.Now().Add(childGrace); d.Before(deadline) {
					deadline = d
				}
			}
		}
		if time.Now().After(deadline) {
			_ = windows.TerminateJobObject(job, 98)
			res = w.exitCode(pi.Process, res)
			res.TimedOut = true
			return res
		}
		select {
		case <-ctx.Done():
			_ = windows.TerminateJobObject(job, 98)
			res.Err = errors.New("o agente parou durante a desinstalacao")
			return res
		case <-tick.C:
		}
	}
	return w.exitCode(pi.Process, res)
}

func (w *winSystem) waitProcess(ctx context.Context, h windows.Handle, timeout time.Duration, res runResult) runResult {
	done := make(chan struct{})
	go func() {
		_, _ = windows.WaitForSingleObject(h, windows.INFINITE)
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
		_ = windows.TerminateProcess(h, 98)
		res.Err = errors.New("o agente parou durante a desinstalacao")
		return res
	case <-time.After(timeout):
		_ = windows.TerminateProcess(h, 98)
		res.TimedOut = true
		return res
	}
	return w.exitCode(h, res)
}

func (w *winSystem) exitCode(h windows.Handle, res runResult) runResult {
	_, _ = windows.WaitForSingleObject(h, 5000)
	var code uint32
	if err := windows.GetExitCodeProcess(h, &code); err != nil {
		res.Err = err
		return res
	}
	res.ExitCode = int(int32(code))
	return res
}

var unsafeName = regexp.MustCompile(`[^A-Za-z0-9 ._-]+`)

func (w *winSystem) BackupDir(name string) string {
	n := strings.TrimSpace(unsafeName.ReplaceAllString(name, "_"))
	if len(n) > 60 {
		n = n[:60]
	}
	if n == "" {
		n = "programa"
	}
	return filepath.Join(config.DataDir(), "desinstalacao", time.Now().Format("20060102-150405")+" "+n)
}

func (w *winSystem) Remove(ctx context.Context, it Leftover, backupDir string) (bool, error) {
	switch it.Kind {
	case KindKey:
		if err := exportKey(ctx, it.Path, backupDir); err != nil {
			return false, fmt.Errorf("copia de seguranca falhou, chave mantida: %w", err)
		}
		return false, winsys.RegDeleteKey(it.Path)
	case KindValue:
		if err := exportKey(ctx, it.Path, backupDir); err != nil {
			return false, fmt.Errorf("copia de seguranca falhou, valor mantido: %w", err)
		}
		return false, winsys.RegDeleteValue(it.Path, it.Name)
	case KindService:
		return w.removeService(ctx, it.Path, backupDir)
	case KindTask:
		return false, removeTask(ctx, w.SystemRoot(), it.Path, backupDir)
	case KindFile:
		return removeFile(it.Path)
	case KindDir:
		return removeTree(it.Path)
	}
	return false, fmt.Errorf("tipo desconhecido: %s", it.Kind)
}

var backupSeq int

// exportKey grava a chave num .reg (reg export) antes da exclusao.
func exportKey(ctx context.Context, key, backupDir string) error {
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		return err
	}
	backupSeq++
	file := filepath.Join(backupDir, fmt.Sprintf("registro-%03d.reg", backupSeq))
	reg := filepath.Join(getenv("SystemRoot", `C:\Windows`), `System32\reg.exe`)
	res := execx.Run(ctx, execx.Spec{Path: reg, Args: []string{"export", key, file, "/y", "/reg:64"}, Timeout: time.Minute})
	if res.Err != nil || res.ExitCode != 0 {
		return errors.New(clip(strings.TrimSpace(res.Combined()), 300))
	}
	return nil
}

func (w *winSystem) removeService(ctx context.Context, name, backupDir string) (bool, error) {
	m, err := mgr.Connect()
	if err != nil {
		return false, err
	}
	defer m.Disconnect()
	s, err := m.OpenService(name)
	if err != nil {
		return false, err
	}
	defer s.Close()
	cfg, err := s.Config()
	if err != nil {
		return false, err
	}
	if !w.Layout().imageOutsideSystem(expand(cfg.BinaryPathName)) {
		return false, errors.New("servico do Windows ou do agente")
	}
	if err := exportKey(ctx, `HKLM\SYSTEM\CurrentControlSet\Services\`+name, backupDir); err != nil {
		return false, fmt.Errorf("copia de seguranca falhou, servico mantido: %w", err)
	}
	if st, err := s.Query(); err == nil && st.State != svc.Stopped {
		_, _ = s.Control(svc.Stop)
		for i := 0; i < 40; i++ {
			if st, err := s.Query(); err != nil || st.State == svc.Stopped {
				break
			}
			time.Sleep(500 * time.Millisecond)
		}
	}
	if err := s.Delete(); err != nil {
		return false, err
	}
	st, err := s.Query()
	return err == nil && st.State != svc.Stopped, nil
}

func removeTask(ctx context.Context, systemRoot, name, backupDir string) error {
	file := filepath.Join(systemRoot, `System32\Tasks`, strings.TrimPrefix(name, `\`))
	if data, err := os.ReadFile(file); err == nil {
		if err := os.MkdirAll(backupDir, 0o700); err == nil {
			_ = os.WriteFile(filepath.Join(backupDir, "tarefa "+unsafeName.ReplaceAllString(strings.TrimPrefix(name, `\`), "_")+".xml"), data, 0o600)
		}
	}
	exe := filepath.Join(systemRoot, `System32\schtasks.exe`)
	res := execx.Run(ctx, execx.Spec{Path: exe, Args: []string{"/Delete", "/TN", name, "/F"}, Timeout: time.Minute})
	if res.Err != nil || res.ExitCode != 0 {
		return errors.New(clip(strings.TrimSpace(res.Combined()), 300))
	}
	return nil
}

// deleteOnReboot agenda a exclusao para o proximo reinicio (arquivo em uso).
func deleteOnReboot(p string) error {
	ptr, err := windows.UTF16PtrFromString(p)
	if err != nil {
		return err
	}
	return windows.MoveFileEx(ptr, nil, windows.MOVEFILE_DELAY_UNTIL_REBOOT)
}

func removeFile(p string) (bool, error) {
	info, err := os.Lstat(p)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if info.IsDir() && !isReparse(info) {
		return false, errors.New("e uma pasta")
	}
	return removeOne(p, info)
}

// removeOne apaga um arquivo (tirando o somente leitura) ou agenda para o reinicio.
func removeOne(p string, info fs.FileInfo) (bool, error) {
	if info.Mode().Perm()&0o200 == 0 {
		_ = os.Chmod(p, 0o666)
	}
	if err := os.Remove(p); err == nil || errors.Is(err, fs.ErrNotExist) {
		return false, nil
	} else if rerr := deleteOnReboot(p); rerr != nil {
		return false, err
	}
	return true, nil
}

// removeTree apaga a pasta sem seguir junctions e links (o link sai, o destino fica). O que
// estiver em uso fica agendado para o proximo reinicio.
func removeTree(root string) (bool, error) {
	info, err := os.Lstat(root)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !info.IsDir() || isReparse(info) {
		return removeOne(root, info)
	}
	var files, dirs []string
	walkErr := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		fi, err := d.Info()
		if err != nil {
			return nil
		}
		switch {
		case p == root:
			dirs = append(dirs, p)
		case isReparse(fi):
			files = append(files, p)
			if d.IsDir() {
				return filepath.SkipDir
			}
		case d.IsDir():
			dirs = append(dirs, p)
		default:
			files = append(files, p)
		}
		return nil
	})
	if walkErr != nil {
		return false, walkErr
	}
	reboot, failed := false, 0
	for _, f := range files {
		fi, err := os.Lstat(f)
		if err != nil {
			continue
		}
		r, err := removeOne(f, fi)
		if err != nil {
			failed++
		}
		reboot = reboot || r
	}
	// Pastas da mais funda para a mais rasa.
	sort.Slice(dirs, func(i, j int) bool { return len(dirs[i]) > len(dirs[j]) })
	for _, d := range dirs {
		if err := os.Remove(d); err != nil && !errors.Is(err, fs.ErrNotExist) {
			if deleteOnReboot(d) == nil {
				reboot = true
			} else {
				failed++
			}
		}
	}
	if failed > 0 {
		return reboot, fmt.Errorf("%d item(ns) nao puderam ser apagados nem agendados", failed)
	}
	return reboot, nil
}
