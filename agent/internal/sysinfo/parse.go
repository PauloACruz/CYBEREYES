package sysinfo

import (
	"strconv"
	"strings"
)

// procStatBootTime le a linha "btime" de /proc/stat.
func procStatBootTime(data string) int64 {
	for _, line := range strings.Split(data, "\n") {
		if f := strings.Fields(line); len(f) == 2 && f[0] == "btime" {
			n, _ := strconv.ParseInt(f[1], 10, 64)
			return n
		}
	}
	return 0
}

// osReleaseName devolve PRETTY_NAME de os-release, ou NAME e VERSION.
func osReleaseName(data string) string {
	vals := map[string]string{}
	for _, line := range strings.Split(data, "\n") {
		line = strings.TrimSpace(line)
		k, v, ok := strings.Cut(line, "=")
		if !ok || strings.HasPrefix(line, "#") {
			continue
		}
		v = strings.TrimSpace(v)
		if len(v) >= 2 && (v[0] == '"' || v[0] == '\'') && v[len(v)-1] == v[0] {
			v = v[1 : len(v)-1]
		}
		vals[strings.TrimSpace(k)] = v
	}
	if p := vals["PRETTY_NAME"]; p != "" {
		return p
	}
	return strings.TrimSpace(vals["NAME"] + " " + vals["VERSION"])
}

// ignoredUsers sao contas de gerenciadores de login e de sistema, que nao contam como usuario conectado.
var ignoredUsers = map[string]bool{"gdm": true, "gdm-greeter": true, "lightdm": true, "sddm": true, "_mbsetupuser": true, "nobody": true}

func ignoredUser(u string) bool {
	return u == "" || ignoredUsers[u] || strings.HasPrefix(u, "gdm-") || strings.HasPrefix(u, "_")
}

// parseLoginctl escolhe o usuario de "loginctl list-sessions --no-legend": prefere sessao com
// seat (grafica ou console local) e depois qualquer outra sessao de usuario.
func parseLoginctl(out string) string {
	fallback := ""
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 3 || ignoredUser(f[2]) {
			continue
		}
		if len(f) >= 4 && strings.HasPrefix(f[3], "seat") {
			return f[2]
		}
		if fallback == "" {
			fallback = f[2]
		}
	}
	return fallback
}

// parseWho escolhe o usuario da saida de "who": prefere o console (tty, :0, console) a sessoes remotas.
func parseWho(out string) string {
	fallback := ""
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 2 || ignoredUser(f[0]) {
			continue
		}
		tty := f[1]
		if tty == "console" || strings.HasPrefix(tty, "tty") || strings.HasPrefix(tty, ":") || strings.HasPrefix(tty, "seat") {
			return f[0]
		}
		if fallback == "" {
			fallback = f[0]
		}
	}
	return fallback
}

// formatWindowsOS monta o nome do Windows a partir do registro. O ProductName do Windows 11
// ainda diz "Windows 10": a versao e corrigida pelo numero de build (22000 ou maior).
func formatWindowsOS(product, display, build string, ubr uint64, is64 bool) string {
	product = strings.TrimSpace(product)
	if product == "" {
		product = "Windows"
	}
	if n, err := strconv.Atoi(build); err == nil && n >= 22000 && strings.Contains(product, "Windows 10") {
		product = strings.Replace(product, "Windows 10", "Windows 11", 1)
	}
	bits := "32 bit"
	if is64 {
		bits = "64 bit"
	}
	s := product + ", " + bits
	if display != "" {
		s += " v" + display
	}
	if build != "" {
		b := build
		if ubr > 0 {
			b += "." + strconv.FormatUint(ubr, 10)
		}
		s += " (build " + b + ")"
	}
	return s
}
