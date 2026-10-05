//go:build windows

package care

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"

	"github.com/pauloacruz/cybereyes/agent/internal/winevt"
)

func platformProbes() []probe {
	return []probe{
		{key: "cpu", label: "Uso de CPU", category: catPerformance, timeout: 10 * time.Second, first: true, fn: winCPU},
		{key: "memory", label: "Memoria", category: catPerformance, timeout: 5 * time.Second, fn: winMemory},
		{key: "disk", label: "Espaco em disco", category: catStorage, timeout: 20 * time.Second, fn: winDisks},
		{key: "uptime", label: "Tempo ligado", category: catStability, timeout: 5 * time.Second, fn: winUptime},
		{key: "pending_reboot", label: "Reinicio pendente", category: catStability, timeout: 10 * time.Second, fn: winPendingReboot},
		{key: "services", label: "Servicos automaticos parados", category: catStability, timeout: 30 * time.Second, fn: winServices},
		{key: "system_errors", label: "Erros de sistema (24 h)", category: catStability, timeout: 45 * time.Second, fn: winSystemErrors},
		{key: "security", label: "Antivirus e firewall", category: catSecurity, timeout: 50 * time.Second, fn: winSecurity},
		{key: "updates", label: "Atualizacoes pendentes", category: catSecurity, timeout: 75 * time.Second, fn: winUpdates},
	}
}

var (
	kernel32                 = windows.NewLazySystemDLL("kernel32.dll")
	procGetSystemTimes       = kernel32.NewProc("GetSystemTimes")
	procGlobalMemoryStatusEx = kernel32.NewProc("GlobalMemoryStatusEx")
	procGetTickCount64       = kernel32.NewProc("GetTickCount64")
)

func ftUint(ft windows.Filetime) uint64 { return uint64(ft.HighDateTime)<<32 | uint64(ft.LowDateTime) }

func systemTimes() (idle, total uint64, err error) {
	var i, k, u windows.Filetime
	r, _, e := procGetSystemTimes.Call(uintptr(unsafe.Pointer(&i)), uintptr(unsafe.Pointer(&k)), uintptr(unsafe.Pointer(&u)))
	if r == 0 {
		return 0, 0, e
	}
	// O tempo de kernel ja inclui o ocioso.
	return ftUint(i), ftUint(k) + ftUint(u), nil
}

// winCPU mede o uso de CPU em uma amostra de 2 segundos (o Windows nao tem carga media).
func winCPU(ctx context.Context) []HealthItem {
	unknown := []HealthItem{{Key: "cpu", Label: "Uso de CPU", Category: catPerformance, Status: hUnknown}}
	i1, t1, err := systemTimes()
	if err != nil {
		return unknown
	}
	select {
	case <-ctx.Done():
		return unknown
	case <-time.After(2 * time.Second):
	}
	i2, t2, err := systemTimes()
	if err != nil || t2 <= t1 {
		return unknown
	}
	busy := 1 - float64(i2-i1)/float64(t2-t1)
	return []HealthItem{cpuUsageItem(max(0, min(100, busy*100)))}
}

type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

func winMemory(context.Context) []HealthItem {
	var m memoryStatusEx
	m.Length = uint32(unsafe.Sizeof(m))
	if r, _, e := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&m))); r == 0 {
		return []HealthItem{{Key: "memory", Label: "Memoria", Category: catPerformance, Status: hUnknown, Detail: e.Error()}}
	}
	return []HealthItem{memoryItem(m.TotalPhys, m.AvailPhys)}
}

func winDisks(context.Context) []HealthItem {
	buf := make([]uint16, 512)
	n, err := windows.GetLogicalDriveStrings(uint32(len(buf)), &buf[0])
	if err != nil || n == 0 || int(n) > len(buf) {
		return []HealthItem{{Key: "disk", Label: "Espaco em disco", Category: catStorage, Status: hUnknown, Detail: "Falha ao listar as unidades"}}
	}
	sys := strings.ToUpper(strings.TrimSuffix(os.Getenv("SystemDrive"), `\`))
	if sys == "" {
		sys = "C:"
	}
	var items []HealthItem
	for _, root := range strings.Split(string(utf16.Decode(buf[:n])), "\x00") {
		if root == "" {
			continue
		}
		p, err := windows.UTF16PtrFromString(root)
		if err != nil || windows.GetDriveType(p) != windows.DRIVE_FIXED {
			continue
		}
		var avail, total, free uint64
		if err := windows.GetDiskFreeSpaceEx(p, &avail, &total, &free); err != nil || total == 0 {
			continue
		}
		name := strings.ToUpper(strings.TrimSuffix(root, `\`))
		items = append(items, diskItem(name, total, free, name == sys))
	}
	if len(items) == 0 {
		return []HealthItem{{Key: "disk", Label: "Espaco em disco", Category: catStorage, Status: hUnknown, Detail: "Nenhuma unidade fixa encontrada"}}
	}
	return items
}

func winUptime(context.Context) []HealthItem {
	r1, r2, _ := procGetTickCount64.Call()
	ms := uint64(r1)
	if unsafe.Sizeof(uintptr(0)) == 4 {
		// Em 32 bits o valor de 64 bits volta em EDX:EAX.
		ms = uint64(r2)<<32 | uint64(uint32(r1))
	}
	return []HealthItem{uptimeItem(time.Duration(ms) * time.Millisecond)}
}

func regKeyExists(path string) bool {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	k.Close()
	return true
}

func regString(path, name string) string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	v, _, _ := k.GetStringValue(name)
	return v
}

// winPendingReboot: servicing de componentes, Windows Update e troca de nome do computador.
// PendingFileRenameOperations fica de fora: antivirus e instaladores o deixam preenchido o tempo todo.
func winPendingReboot(context.Context) []HealthItem {
	var reasons []string
	if regKeyExists(`SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending`) {
		reasons = append(reasons, "Manutencao de componentes do Windows (CBS)")
	}
	if regKeyExists(`SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired`) {
		reasons = append(reasons, "Windows Update")
	}
	active := regString(`SYSTEM\CurrentControlSet\Control\ComputerName\ActiveComputerName`, "ComputerName")
	pending := regString(`SYSTEM\CurrentControlSet\Control\ComputerName\ComputerName`, "ComputerName")
	if active != "" && pending != "" && !strings.EqualFold(active, pending) {
		reasons = append(reasons, "Troca do nome do computador para "+pending)
	}
	return []HealthItem{rebootItem(reasons)}
}

// Servicos automaticos que param sozinhos por projeto.
var winIgnoredServices = map[string]bool{
	"sppsvc": true, "gupdate": true, "gupdatem": true, "edgeupdate": true, "edgeupdatem": true,
	"mapsbroker": true, "remoteregistry": true, "trustedinstaller": true, "tiledatamodelsvc": true,
}

const errServiceNeverStarted = 1077

// winServices lista servicos de inicio automatico parados com falha: sem gatilho (trigger start),
// sem os que pararam normalmente (codigo 0) e sem os atrasados que ainda nao iniciaram.
func winServices(ctx context.Context) []HealthItem {
	unknown := func(d string) []HealthItem {
		return []HealthItem{{Key: "services", Label: "Servicos automaticos parados", Category: catStability, Status: hUnknown, Detail: d}}
	}
	scm, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT|windows.SC_MANAGER_ENUMERATE_SERVICE)
	if err != nil {
		return unknown("Falha ao abrir o gerenciador de servicos: " + err.Error())
	}
	defer windows.CloseServiceHandle(scm)
	size := uint32(64 << 10)
	var buf []byte
	var count uint32
	for range 5 {
		buf = make([]byte, size)
		var needed, resume uint32
		err = windows.EnumServicesStatusEx(scm, windows.SC_ENUM_PROCESS_INFO, windows.SERVICE_WIN32, windows.SERVICE_INACTIVE,
			&buf[0], size, &needed, &count, &resume, nil)
		if err == nil {
			break
		}
		if !errors.Is(err, windows.ERROR_MORE_DATA) {
			return unknown("Falha ao listar os servicos: " + err.Error())
		}
		size += needed + 4096
	}
	if err != nil {
		return unknown("Falha ao listar os servicos: " + err.Error())
	}
	var failed []string
	if count > 0 {
		list := unsafe.Slice((*windows.ENUM_SERVICE_STATUS_PROCESS)(unsafe.Pointer(&buf[0])), count)
		for _, e := range list {
			if ctx.Err() != nil {
				break
			}
			st := e.ServiceStatusProcess
			name := windows.UTF16PtrToString(e.ServiceName)
			if st.CurrentState != windows.SERVICE_STOPPED || winIgnoredServices[strings.ToLower(name)] {
				continue
			}
			if st.Win32ExitCode == 0 && st.ServiceSpecificExitCode == 0 {
				continue
			}
			auto, delayed, trigger, ok := serviceStartInfo(scm, name)
			if !ok || !auto || trigger || (delayed && st.Win32ExitCode == errServiceNeverStarted) {
				continue
			}
			display := windows.UTF16PtrToString(e.DisplayName)
			if display == "" {
				display = name
			}
			failed = append(failed, display)
		}
	}
	return []HealthItem{servicesItem("Servicos automaticos parados", failed)}
}

// serviceStartInfo informa se o servico e automatico, atrasado e se tem gatilhos de inicio.
func serviceStartInfo(scm windows.Handle, name string) (auto, delayed, trigger, ok bool) {
	p, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return
	}
	h, err := windows.OpenService(scm, p, windows.SERVICE_QUERY_CONFIG)
	if err != nil {
		return
	}
	defer windows.CloseServiceHandle(h)
	n := uint32(1024)
	var cfg *windows.QUERY_SERVICE_CONFIG
	for range 3 {
		b := make([]byte, n)
		cfg = (*windows.QUERY_SERVICE_CONFIG)(unsafe.Pointer(&b[0]))
		err = windows.QueryServiceConfig(h, cfg, n, &n)
		if err == nil {
			break
		}
		if !errors.Is(err, windows.ERROR_INSUFFICIENT_BUFFER) {
			return
		}
	}
	if err != nil {
		return
	}
	auto = cfg.StartType == windows.SERVICE_AUTO_START
	if b := queryConfig2(h, windows.SERVICE_CONFIG_DELAYED_AUTO_START_INFO); len(b) >= 4 {
		delayed = binary.LittleEndian.Uint32(b) != 0
	}
	if b := queryConfig2(h, windows.SERVICE_CONFIG_TRIGGER_INFO); len(b) >= 4 {
		trigger = binary.LittleEndian.Uint32(b) > 0
	}
	return auto, delayed, trigger, true
}

func queryConfig2(h windows.Handle, level uint32) []byte {
	var needed uint32
	err := windows.QueryServiceConfig2(h, level, nil, 0, &needed)
	if err == nil || !errors.Is(err, windows.ERROR_INSUFFICIENT_BUFFER) || needed == 0 {
		return nil
	}
	b := make([]byte, needed)
	if err := windows.QueryServiceConfig2(h, level, &b[0], needed, &needed); err != nil {
		return nil
	}
	return b
}

// winSystemErrors conta erros e eventos criticos do log System nas ultimas 24 h.
func winSystemErrors(context.Context) []HealthItem {
	events, err := winevt.Query("System", time.Now().Add(-24*time.Hour), 5000)
	if err != nil {
		return []HealthItem{{Key: "system_errors", Label: "Erros de sistema (24 h)", Category: catStability, Status: hUnknown, Detail: err.Error()}}
	}
	count, critical := 0, 0
	bySource := map[string]int{}
	for _, e := range events {
		if e.Level != 1 && e.Level != 2 {
			continue
		}
		count++
		if e.Level == 1 {
			critical++
		}
		src := e.Source
		if src == "" {
			src = "?"
		}
		bySource[src]++
	}
	return []HealthItem{errorsItem(count, bySource, critical)}
}

// --- Antivirus e firewall -------------------------------------------------------

const securityScript = `$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='SilentlyContinue'
$r = [ordered]@{ server = $false; av = @(); fw = @(); mp = $null }
$os = Get-CimInstance -ClassName Win32_OperatingSystem -OperationTimeoutSec 20
if ($os -and $os.ProductType -ne 1) { $r.server = $true }
$r.av = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -OperationTimeoutSec 20 | ForEach-Object { [ordered]@{ name = [string]$_.displayName; state = [int64]$_.productState } })
$r.fw = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName FirewallProduct -OperationTimeoutSec 20 | ForEach-Object { [ordered]@{ name = [string]$_.displayName; state = [int64]$_.productState } })
$m = Get-CimInstance -Namespace root/Microsoft/Windows/Defender -ClassName MSFT_MpComputerStatus -OperationTimeoutSec 20
if ($m) { $r.mp = [ordered]@{ service = [bool]$m.AMServiceEnabled; enabled = [bool]$m.AntivirusEnabled; realtime = [bool]$m.RealTimeProtectionEnabled; sigAge = [int]$m.AntivirusSignatureAge; mode = [string]$m.AMRunningMode } }
ConvertTo-Json -InputObject $r -Compress -Depth 4`

type secProduct struct {
	Name  string `json:"name"`
	State int64  `json:"state"`
}

// enabled e upToDate decodificam productState da Central de Seguranca (0xTTEEUU:
// EE 0x1X ligado; UU 0x10 desatualizado).
func (p secProduct) enabled() bool  { return (p.State>>12)&0xF == 1 }
func (p secProduct) upToDate() bool { return (p.State>>4)&0xF == 0 }

type securityInfo struct {
	Server bool         `json:"server"`
	AV     []secProduct `json:"av"`
	FW     []secProduct `json:"fw"`
	MP     *struct {
		Service  bool   `json:"service"`
		Enabled  bool   `json:"enabled"`
		Realtime bool   `json:"realtime"`
		SigAge   int    `json:"sigAge"`
		Mode     string `json:"mode"`
	} `json:"mp"`
}

func winSecurity(ctx context.Context) []HealthItem {
	var info securityInfo
	out, perr := runPowerShell(ctx, securityScript)
	if perr == nil {
		perr = json.Unmarshal([]byte(lastJSON(out)), &info)
	}
	return []HealthItem{antivirusItem(info, perr), firewallItem(info, perr == nil)}
}

func antivirusItem(info securityInfo, perr error) HealthItem {
	it := HealthItem{Key: "antivirus", Label: "Antivirus", Category: catSecurity, Weight: 15}
	if perr != nil {
		it.Status, it.Detail = hUnknown, "Falha na consulta: "+perr.Error()
		return it
	}
	defenderOld := info.MP != nil && info.MP.Enabled && info.MP.SigAge > 7
	if len(info.AV) > 0 {
		var on, names []string
		updated := false
		for _, p := range info.AV {
			names = append(names, p.Name)
			if p.enabled() {
				on = append(on, p.Name)
				if p.upToDate() && !(strings.Contains(strings.ToLower(p.Name), "defender") && defenderOld) {
					updated = true
				}
			}
		}
		switch {
		case len(on) == 0:
			it.Status, it.Value, it.Detail = hCritical, "Desligado", "Instalado(s): "+strings.Join(names, ", ")
		case !updated:
			it.Status, it.Value, it.Detail = hWarning, strings.Join(on, ", "), "Definicoes desatualizadas"
		default:
			it.Status, it.Value = hOK, strings.Join(on, ", ")
		}
		return it
	}
	if info.MP != nil {
		it.Value = "Microsoft Defender"
		switch {
		case info.MP.Enabled && info.MP.Realtime && info.MP.SigAge <= 7:
			it.Status = hOK
		case info.MP.Enabled && info.MP.Realtime:
			it.Status, it.Detail = hWarning, fmt.Sprintf("Definicoes com %d dias", info.MP.SigAge)
		case info.MP.Enabled || info.MP.Service:
			it.Status, it.Detail = hWarning, "Protecao em tempo real desligada"
		case strings.Contains(strings.ToLower(info.MP.Mode), "passive"):
			it.Status, it.Detail = hUnknown, "Defender em modo passivo (outro antivirus pode estar ativo)"
		default:
			it.Status, it.Value = hCritical, "Desligado"
		}
		return it
	}
	it.Status, it.Detail = hUnknown, "Nenhum antivirus registrado na Central de Seguranca e Defender indisponivel"
	return it
}

// firewallItem le os perfis do Firewall do Windows no registro (a politica de grupo prevalece).
func firewallItem(info securityInfo, haveInfo bool) HealthItem {
	it := HealthItem{Key: "firewall", Label: "Firewall", Category: catSecurity, Weight: 10}
	profiles := []struct{ name, std, pol string }{
		{"Dominio", "DomainProfile", "DomainProfile"},
		{"Privado", "StandardProfile", "PrivateProfile"},
		{"Publico", "PublicProfile", "PublicProfile"},
	}
	var off []string
	read := 0
	for _, p := range profiles {
		v, ok := regDword(`SOFTWARE\Policies\Microsoft\WindowsFirewall\`+p.pol, "EnableFirewall")
		if !ok {
			v, ok = regDword(`SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\`+p.std, "EnableFirewall")
		}
		if !ok {
			continue
		}
		read++
		if v == 0 {
			off = append(off, p.name)
		}
	}
	var third []string
	if haveInfo {
		for _, p := range info.FW {
			if p.enabled() && !strings.Contains(strings.ToLower(p.Name), "windows") {
				third = append(third, p.Name)
			}
		}
	}
	switch {
	case read == 0 && len(third) == 0:
		it.Status, it.Detail = hUnknown, "Perfis do firewall nao encontrados no registro"
	case len(off) == 0:
		it.Status, it.Value = hOK, "Ligado em todos os perfis"
	case len(third) > 0:
		it.Status, it.Value, it.Detail = hOK, strings.Join(third, ", "), "Firewall do Windows desligado em: "+strings.Join(off, ", ")
	case len(off) == read:
		it.Status, it.Value = hCritical, "Desligado"
	default:
		it.Status, it.Value = hWarning, "Desligado em: "+strings.Join(off, ", ")
	}
	return it
}

func regDword(path, name string) (uint64, bool) {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE)
	if err != nil {
		return 0, false
	}
	defer k.Close()
	v, _, err := k.GetIntegerValue(name)
	return v, err == nil
}

// --- Windows Update --------------------------------------------------------------

// Busca no cache local do Windows Update (Online = false): nao vai a internet e responde em segundos.
const updatesScript = `$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'
$r = [ordered]@{ total = 0; sec = 0; titles = @(); lastSearch = ''; lastInstall = ''; err = '' }
try {
  $res = (New-Object -ComObject Microsoft.Update.AutoUpdate).Results
  if ($res.LastSearchSuccessDate) { $r.lastSearch = ([datetime]$res.LastSearchSuccessDate).ToString('yyyy-MM-ddTHH:mm:ssZ') }
  if ($res.LastInstallationSuccessDate) { $r.lastInstall = ([datetime]$res.LastInstallationSuccessDate).ToString('yyyy-MM-ddTHH:mm:ssZ') }
} catch { }
try {
  $q = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher()
  $q.Online = $false
  $found = $q.Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
  foreach ($u in $found.Updates) {
    $r.total++
    $s = @('Critical', 'Important') -contains [string]$u.MsrcSeverity
    foreach ($c in $u.Categories) {
      if (@('0fa1201d-4330-4fa8-8ae9-b877473b6441', 'e6cf1350-c01b-414d-a61f-263d14d133b4') -contains ([string]$c.CategoryID).ToLower()) { $s = $true }
    }
    if ($s) { $r.sec++ }
    if ($r.titles.Count -lt 5) { $r.titles += [string]$u.Title }
  }
} catch { $r.err = [string]$_.Exception.Message }
ConvertTo-Json -InputObject $r -Compress`

func winUpdates(ctx context.Context) []HealthItem {
	unknown := func(d string) []HealthItem {
		return []HealthItem{{Key: "updates", Label: "Atualizacoes pendentes", Category: catSecurity, Status: hUnknown, Detail: d}}
	}
	out, err := runPowerShell(ctx, updatesScript)
	if err != nil {
		return unknown("Falha na consulta ao Windows Update: " + err.Error())
	}
	var r struct {
		Total       int      `json:"total"`
		Sec         int      `json:"sec"`
		Titles      []string `json:"titles"`
		LastSearch  string   `json:"lastSearch"`
		LastInstall string   `json:"lastInstall"`
		Err         string   `json:"err"`
	}
	if err := json.Unmarshal([]byte(lastJSON(out)), &r); err != nil {
		return unknown("Resposta invalida do Windows Update")
	}
	if r.Err != "" && r.Total == 0 {
		return unknown("Windows Update: " + r.Err)
	}
	var notes []string
	if len(r.Titles) > 0 {
		notes = append(notes, strings.Join(r.Titles, "; "))
	}
	lastSearch, searchOK := parseWUDate(r.LastSearch)
	if searchOK {
		notes = append(notes, "Ultima verificacao: "+lastSearch.Format("2006-01-02"))
	}
	it := updatesItem(r.Total, r.Sec, strings.Join(notes, ". "))
	if searchOK && time.Since(lastSearch) > 30*24*time.Hour && it.Status == hOK {
		it.Status, it.Value = hWarning, "Sem verificacao ha mais de 30 dias"
	}
	if lastInstall, ok := parseWUDate(r.LastInstall); ok && r.Total > 0 && time.Since(lastInstall) > 60*24*time.Hour {
		it.Status = hCritical
		it.Detail = strings.TrimSpace(it.Detail + ". Ultima instalacao: " + lastInstall.Format("2006-01-02"))
	}
	return []HealthItem{it}
}

func parseWUDate(s string) (time.Time, bool) {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil || t.Year() < 2000 {
		return time.Time{}, false
	}
	return t, true
}

// runPowerShell executa um trecho fixo no Windows PowerShell com saida UTF-8 (-EncodedCommand evita aspas).
func runPowerShell(ctx context.Context, script string) (string, error) {
	root := os.Getenv("SystemRoot")
	if root == "" {
		root = `C:\Windows`
	}
	ps := filepath.Join(root, `System32\WindowsPowerShell\v1.0\powershell.exe`)
	full := "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false\n" + script
	u := utf16.Encode([]rune(full))
	b := make([]byte, len(u)*2)
	for i, c := range u {
		binary.LittleEndian.PutUint16(b[i*2:], c)
	}
	out, errOut, code, err := runCmd(ctx, nil, ps, "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-EncodedCommand", base64.StdEncoding.EncodeToString(b))
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(out) == "" {
		if code != 0 {
			return "", fmt.Errorf("PowerShell terminou com codigo %d: %s", code, truncate(strings.TrimSpace(errOut), 200))
		}
		return "", errors.New("PowerShell sem resposta")
	}
	return out, nil
}

// lastJSON devolve a ultima linha que parece um objeto JSON.
func lastJSON(out string) string {
	lines := strings.Split(strings.TrimSpace(out), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		l := strings.TrimSpace(lines[i])
		if strings.HasPrefix(l, "{") {
			return l
		}
	}
	return ""
}
