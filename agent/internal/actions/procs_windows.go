//go:build windows

package actions

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ntProc e um processo lido de NtQuerySystemInformation(SystemProcessInformation).
type ntProc struct {
	pid    int
	name   string
	cpu    time.Duration
	rss    int64
	parent int
}

// readNtProcs le todos os processos de uma vez (inclusive os protegidos, sem abrir cada um).
func readNtProcs() ([]ntProc, error) {
	size := uint32(512 << 10)
	for i := 0; i < 8; i++ {
		buf := make([]uint64, size/8+1) // alinhado em 8 bytes
		var needed uint32
		err := windows.NtQuerySystemInformation(windows.SystemProcessInformation, unsafe.Pointer(&buf[0]), uint32(len(buf)*8), &needed)
		if err == nil {
			return parseNtProcs(unsafe.Slice((*byte)(unsafe.Pointer(&buf[0])), len(buf)*8)), nil
		}
		if !errors.Is(err, windows.STATUS_INFO_LENGTH_MISMATCH) && !errors.Is(err, windows.STATUS_BUFFER_TOO_SMALL) {
			return nil, err
		}
		if needed > size {
			size = needed + 64<<10
		} else {
			size *= 2
		}
	}
	return nil, errors.New("lista de processos grande demais")
}

func parseNtProcs(b []byte) []ntProc {
	out := make([]ntProc, 0, 256)
	off := 0
	for off+int(unsafe.Sizeof(windows.SYSTEM_PROCESS_INFORMATION{})) <= len(b) {
		p := (*windows.SYSTEM_PROCESS_INFORMATION)(unsafe.Pointer(&b[off]))
		pid := int(p.UniqueProcessID)
		name := p.ImageName.String()
		switch {
		case pid == 0:
			name = "System Idle Process"
		case name == "" && pid == 4:
			name = "System"
		}
		out = append(out, ntProc{
			pid:    pid,
			name:   name,
			cpu:    time.Duration(p.UserTime+p.KernelTime) * 100, // unidades de 100 ns
			rss:    int64(p.WorkingSetSize),
			parent: int(p.InheritedFromUniqueProcessID),
		})
		if p.NextEntryOffset == 0 {
			break
		}
		off += int(p.NextEntryOffset)
	}
	return out
}

func listProcs(ctx context.Context) ([]Proc, error) {
	var last []ntProc
	read := func() (procTimes, error) {
		list, err := readNtProcs()
		if err != nil {
			return nil, err
		}
		last = list
		t := procTimes{}
		for _, p := range list {
			t[p.pid] = p.cpu
		}
		return t, nil
	}
	first, second, elapsed, err := sampleCPU(ctx, read)
	if err != nil {
		return nil, err
	}
	users := map[string]string{}
	out := make([]Proc, 0, len(last))
	for _, p := range last {
		cpu := usage(p.pid, first, second, elapsed)
		if p.pid == 0 {
			cpu = formatCPU(0) // tempo ocioso nao e uso
		}
		out = append(out, Proc{
			PID:        p.pid,
			Name:       p.name,
			Username:   processUser(p.pid, users),
			MemBytes:   p.rss,
			CPUPercent: cpu,
		})
	}
	return out, nil
}

// processUser devolve a conta dona do processo (so o nome, como o Gerenciador de Tarefas).
func processUser(pid int, cache map[string]string) string {
	if pid == 0 || pid == 4 {
		return "SYSTEM"
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	var tok windows.Token
	if err := windows.OpenProcessToken(h, windows.TOKEN_QUERY, &tok); err != nil {
		return ""
	}
	defer tok.Close()
	tu, err := tok.GetTokenUser()
	if err != nil {
		return ""
	}
	sid := tu.User.Sid.String()
	if name, ok := cache[sid]; ok {
		return name
	}
	name := sid
	if acc, _, _, err := tu.User.Sid.LookupAccount(""); err == nil {
		name = acc
	}
	cache[sid] = name
	return name
}

// Processos criticos: encerra-los derruba o Windows (tela azul) ou a sessao inteira.
var criticalProcs = map[string]bool{
	"smss.exe": true, "csrss.exe": true, "wininit.exe": true, "services.exe": true,
	"lsass.exe": true, "winlogon.exe": true, "lsaiso.exe": true,
}

// Processos cuja arvore nao e encerrada junto: o explorer e pai de quase todos os programas do usuario.
var noTreeProcs = map[string]bool{"explorer.exe": true}

// killProcess encerra o processo e seus descendentes (filhos primeiro).
func killProcess(pid int) error {
	list, err := readNtProcs()
	if err != nil {
		return fmt.Errorf("falha ao listar processos: %v", err)
	}
	var target *ntProc
	for i := range list {
		if list[i].pid == pid {
			target = &list[i]
			break
		}
	}
	if target == nil {
		return fmt.Errorf("processo %d nao encontrado", pid)
	}
	name := strings.ToLower(target.name)
	if pid == 4 || criticalProcs[name] {
		return fmt.Errorf("o processo %s (%d) e critico para o Windows e nao pode ser encerrado", target.name, pid)
	}
	// Abre o alvo antes de mexer nos filhos: sem permissao, nada e encerrado.
	h, err := windows.OpenProcess(windows.PROCESS_TERMINATE|windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
			return fmt.Errorf("acesso negado ao encerrar o processo %d", pid)
		}
		return fmt.Errorf("processo %d nao encontrado", pid)
	}
	defer windows.CloseHandle(h)
	if !noTreeProcs[name] {
		targetStart := creationTime(pid)
		self := os.Getpid()
		names := make(map[int]string, len(list))
		for _, p := range list {
			names[p.pid] = strings.ToLower(p.name)
		}
		for _, child := range descendants(pid, list) {
			if child == self || criticalProcs[names[child]] {
				continue
			}
			// Confere que o "filho" nasceu depois do pai: o PID do pai pode ter sido reaproveitado.
			if ct := creationTime(child); !targetStart.IsZero() && !ct.IsZero() && ct.Before(targetStart) {
				continue
			}
			_ = terminate(child)
		}
	}
	if err := windows.TerminateProcess(h, 1); err != nil {
		if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
			return fmt.Errorf("acesso negado ao encerrar o processo %d", pid)
		}
		return fmt.Errorf("falha ao encerrar o processo %d: %v", pid, err)
	}
	_, _ = windows.WaitForSingleObject(h, 3000)
	return nil
}

// descendants devolve os descendentes de pid do mais profundo para o mais raso.
func descendants(pid int, list []ntProc) []int {
	children := map[int][]int{}
	for _, p := range list {
		if p.pid != p.parent && p.pid != 0 {
			children[p.parent] = append(children[p.parent], p.pid)
		}
	}
	var order []int
	seen := map[int]bool{pid: true}
	queue := []int{pid}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, c := range children[cur] {
			if !seen[c] {
				seen[c] = true
				order = append(order, c)
				queue = append(queue, c)
			}
		}
	}
	for i, j := 0, len(order)-1; i < j; i, j = i+1, j-1 {
		order[i], order[j] = order[j], order[i]
	}
	return order
}

func creationTime(pid int) time.Time {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return time.Time{}
	}
	defer windows.CloseHandle(h)
	var c, e, k, u windows.Filetime
	if err := windows.GetProcessTimes(h, &c, &e, &k, &u); err != nil {
		return time.Time{}
	}
	return time.Unix(0, c.Nanoseconds())
}

func terminate(pid int) error {
	h, err := windows.OpenProcess(windows.PROCESS_TERMINATE|windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return err
	}
	defer windows.CloseHandle(h)
	if err := windows.TerminateProcess(h, 1); err != nil {
		return err
	}
	_, _ = windows.WaitForSingleObject(h, 3000)
	return nil
}
