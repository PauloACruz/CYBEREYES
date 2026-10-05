package snmp

import (
	"context"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/gosnmp/gosnmp"
)

// Limite de interfaces aceito pelo servidor por resultado.
const maxInterfaces = 2048

// Grupo system (SNMPv2-MIB).
const (
	oidSysDescr    = ".1.3.6.1.2.1.1.1.0"
	oidSysObjectID = ".1.3.6.1.2.1.1.2.0"
	oidSysUpTime   = ".1.3.6.1.2.1.1.3.0"
	oidSysContact  = ".1.3.6.1.2.1.1.4.0"
	oidSysName     = ".1.3.6.1.2.1.1.5.0"
	oidSysLocation = ".1.3.6.1.2.1.1.6.0"
)

var systemOIDs = []string{oidSysDescr, oidSysObjectID, oidSysUpTime, oidSysContact, oidSysName, oidSysLocation}

// Colunas de ifTable (IF-MIB) e ifXTable.
const (
	ifTable  = ".1.3.6.1.2.1.2.2.1"
	ifXTable = ".1.3.6.1.2.1.31.1.1.1"
)

type ifColumn int

const (
	colIndex ifColumn = iota
	colDescr
	colType
	colSpeed
	colAdmin
	colOper
	colIn
	colInErrors
	colOut
	colOutErrors
	colName
	colHCIn
	colHCOut
	colHighSpeed
	colAlias
)

var ifColumns = []struct {
	col ifColumn
	oid string
}{
	{colIndex, ifTable + ".1"},
	{colDescr, ifTable + ".2"},
	{colType, ifTable + ".3"},
	{colSpeed, ifTable + ".5"},
	{colAdmin, ifTable + ".7"},
	{colOper, ifTable + ".8"},
	{colIn, ifTable + ".10"},
	{colInErrors, ifTable + ".14"},
	{colOut, ifTable + ".16"},
	{colOutErrors, ifTable + ".20"},
	{colName, ifXTable + ".1"},
	{colHCIn, ifXTable + ".6"},
	{colHCOut, ifXTable + ".10"},
	{colHighSpeed, ifXTable + ".15"},
	{colAlias, ifXTable + ".18"},
}

// Result e um item de POST /api/v3/snmp/results/.
type Result struct {
	DeviceID   int           `json:"device_id"`
	Time       string        `json:"time"`
	Reachable  bool          `json:"reachable"`
	Error      *string       `json:"error"`
	RTTMs      float64       `json:"rtt_ms"`
	System     *System       `json:"system"`
	Interfaces []Interface   `json:"interfaces,omitempty"`
	Sensors    []SensorValue `json:"sensors,omitempty"`
}

// System e o grupo system do dispositivo.
type System struct {
	Descr       string `json:"descr"`
	ObjectID    string `json:"object_id"`
	UptimeTicks int64  `json:"uptime_ticks"`
	Contact     string `json:"contact"`
	Name        string `json:"name"`
	Location    string `json:"location"`
}

// Interface e uma linha da tabela de interfaces. Status no numero do IF-MIB (0 = ausente).
type Interface struct {
	Index       int     `json:"index"`
	Name        string  `json:"name"`
	Descr       string  `json:"descr"`
	Alias       string  `json:"alias"`
	Type        int     `json:"type"`
	SpeedBps    uint64  `json:"speed_bps"`
	AdminStatus int     `json:"admin_status"`
	OperStatus  int     `json:"oper_status"`
	InOctets    *uint64 `json:"in_octets"`
	OutOctets   *uint64 `json:"out_octets"`
	InErrors    *uint64 `json:"in_errors"`
	OutErrors   *uint64 `json:"out_errors"`
	HC          bool    `json:"hc"`
}

// SensorValue e a leitura de um sensor: valor numerico ou, sem ele, o texto.
type SensorValue struct {
	ID    int      `json:"id"`
	Value *float64 `json:"value"`
	Text  *string  `json:"text"`
}

// TestReply e a resposta do snmp_test (enviada como string JSON).
type TestReply struct {
	Reachable bool    `json:"reachable"`
	Error     *string `json:"error"`
	RTTMs     float64 `json:"rtt_ms"`
	System    *System `json:"system"`
}

// pollSystem le o grupo system. Um erro aqui significa dispositivo sem resposta.
func pollSystem(s session) (*System, time.Duration, error) {
	start := time.Now()
	pkt, err := s.Get(systemOIDs)
	rtt := time.Since(start)
	if err != nil {
		return nil, rtt, err
	}
	sys := &System{}
	for _, v := range pkt.Variables {
		switch normOID(v.Name) {
		case normOID(oidSysDescr):
			sys.Descr = text(v)
		case normOID(oidSysObjectID):
			sys.ObjectID = text(v)
		case normOID(oidSysUpTime):
			if n, ok := toUint(v); ok && n <= math.MaxInt64 {
				sys.UptimeTicks = int64(n)
			}
		case normOID(oidSysContact):
			sys.Contact = text(v)
		case normOID(oidSysName):
			sys.Name = text(v)
		case normOID(oidSysLocation):
			sys.Location = text(v)
		}
	}
	return sys, rtt, nil
}

// poll coleta um dispositivo: system, interfaces (se pedido) e sensores.
func poll(s session, t Target, at time.Time) Result {
	res := Result{DeviceID: t.ID, Time: at.UTC().Format(time.RFC3339Nano)}
	sys, rtt, err := pollSystem(s)
	if err != nil {
		msg := errorText(err)
		res.Error = &msg
		return res
	}
	res.Reachable = true
	res.RTTMs = millis(rtt)
	res.System = sys
	if t.Interfaces {
		res.Interfaces = pollInterfaces(s)
	}
	if len(t.Sensors) > 0 {
		res.Sensors = pollSensors(s, t.Sensors)
	}
	return res
}

func millis(d time.Duration) float64 {
	return math.Round(float64(d)/float64(time.Millisecond)*100) / 100
}

// errorText resume o erro do gosnmp para o console.
func errorText(err error) string {
	msg := err.Error()
	if strings.Contains(strings.ToLower(msg), "timeout") {
		return "sem resposta SNMP (tempo esgotado): " + msg
	}
	return msg
}

// ifRow acumula as colunas de uma interface.
type ifRow struct {
	index                    int
	name, descr, alias       string
	typ, admin, oper         int
	speed, highSpeed         *uint64
	in32, out32, inHC, outHC *uint64
	inErr, outErr            *uint64
}

// pollInterfaces percorre ifTable e ifXTable coluna a coluna. Sem ifTable devolve nil
// (o servidor mantem as interfaces anteriores).
func pollInterfaces(s session) []Interface {
	rows := map[int]*ifRow{}
	row := func(idx int) *ifRow {
		r := rows[idx]
		if r == nil {
			r = &ifRow{index: idx}
			rows[idx] = r
		}
		return r
	}
	tableOK := false
	for _, c := range ifColumns {
		pdus, err := s.Walk(c.oid)
		if err != nil {
			if c.col == colIndex {
				return nil
			}
			continue
		}
		if c.col <= colOutErrors && len(pdus) > 0 {
			tableOK = true
		}
		for _, p := range pdus {
			idx, ok := suffixIndex(c.oid, p.Name)
			if !ok || isEmpty(p) {
				continue
			}
			if c.col != colIndex && rows[idx] == nil && len(rows) >= maxInterfaces {
				continue
			}
			r := row(idx)
			applyColumn(r, c.col, p)
		}
	}
	if !tableOK {
		return nil
	}
	return buildInterfaces(rows)
}

func applyColumn(r *ifRow, col ifColumn, p gosnmp.SnmpPDU) {
	u, uok := toUint(p)
	ptr := func() *uint64 {
		if !uok {
			return nil
		}
		v := u
		return &v
	}
	switch col {
	case colDescr:
		r.descr = text(p)
	case colName:
		r.name = text(p)
	case colAlias:
		r.alias = text(p)
	case colType:
		r.typ = int(min(u, math.MaxInt32))
	case colAdmin:
		r.admin = int(min(u, math.MaxInt32))
	case colOper:
		r.oper = int(min(u, math.MaxInt32))
	case colSpeed:
		r.speed = ptr()
	case colHighSpeed:
		r.highSpeed = ptr()
	case colIn:
		r.in32 = ptr()
	case colOut:
		r.out32 = ptr()
	case colHCIn:
		r.inHC = ptr()
	case colHCOut:
		r.outHC = ptr()
	case colInErrors:
		r.inErr = ptr()
	case colOutErrors:
		r.outErr = ptr()
	}
}

// buildInterfaces monta as linhas em ordem de indice. Contadores de 64 bits quando a interface
// tem os dois (entrada e saida); senao os de 32 bits. Velocidade por ifHighSpeed quando ifSpeed
// satura (4294967295) ou falta.
func buildInterfaces(rows map[int]*ifRow) []Interface {
	idx := make([]int, 0, len(rows))
	for i := range rows {
		idx = append(idx, i)
	}
	sort.Ints(idx)
	if len(idx) > maxInterfaces {
		idx = idx[:maxInterfaces]
	}
	out := make([]Interface, 0, len(idx))
	for _, i := range idx {
		r := rows[i]
		it := Interface{
			Index: r.index, Name: r.name, Descr: r.descr, Alias: r.alias, Type: r.typ,
			AdminStatus: r.admin, OperStatus: r.oper, InErrors: r.inErr, OutErrors: r.outErr,
		}
		if r.speed != nil {
			it.SpeedBps = *r.speed
		}
		if r.highSpeed != nil && *r.highSpeed > 0 && (r.speed == nil || *r.speed == 0 || *r.speed >= math.MaxUint32) {
			it.SpeedBps = *r.highSpeed * 1_000_000
		}
		if r.inHC != nil && r.outHC != nil {
			it.InOctets, it.OutOctets, it.HC = r.inHC, r.outHC, true
		} else {
			it.InOctets, it.OutOctets = r.in32, r.out32
		}
		out = append(out, it)
	}
	return out
}

var numericOID = regexp.MustCompile(`^\.?[0-9]+(\.[0-9]+)+$`)

// pollSensors le os sensores em GETs de ate 10 OIDs.
func pollSensors(s session, sensors []Sensor) []SensorValue {
	out := make([]SensorValue, 0, len(sensors))
	var valid []Sensor
	for _, sn := range sensors {
		oid := strings.TrimSpace(sn.OID)
		if !numericOID.MatchString(oid) {
			out = append(out, textValue(sn.ID, "OID invalido: "+sn.OID))
			continue
		}
		valid = append(valid, Sensor{ID: sn.ID, OID: "." + strings.TrimPrefix(oid, ".")})
	}
	const chunk = 10
	for i := 0; i < len(valid); i += chunk {
		part := valid[i:min(i+chunk, len(valid))]
		oids := make([]string, len(part))
		for j, sn := range part {
			oids[j] = sn.OID
		}
		pkt, err := s.Get(oids)
		if err != nil {
			for _, sn := range part {
				out = append(out, textValue(sn.ID, "erro: "+err.Error()))
			}
			continue
		}
		got := map[string]gosnmp.SnmpPDU{}
		for _, v := range pkt.Variables {
			got[normOID(v.Name)] = v
		}
		for _, sn := range part {
			v, ok := got[normOID(sn.OID)]
			if !ok {
				out = append(out, textValue(sn.ID, "sem resposta para o OID"))
				continue
			}
			out = append(out, sensorValue(sn.ID, v))
		}
	}
	return out
}

func textValue(id int, s string) SensorValue { return SensorValue{ID: id, Text: &s} }

// sensorValue converte a leitura: numero, texto numerico ou texto.
func sensorValue(id int, v gosnmp.SnmpPDU) SensorValue {
	if isEmpty(v) {
		return textValue(id, v.Type.String())
	}
	if f, ok := toFloat(v); ok {
		return SensorValue{ID: id, Value: &f}
	}
	s := text(v)
	if f, err := strconv.ParseFloat(strings.TrimSpace(s), 64); err == nil && !math.IsNaN(f) && !math.IsInf(f, 0) {
		return SensorValue{ID: id, Value: &f}
	}
	return textValue(id, s)
}

// isEmpty informa se a variavel nao tem valor (Null, noSuchObject, noSuchInstance, endOfMibView).
func isEmpty(v gosnmp.SnmpPDU) bool {
	switch v.Type {
	case gosnmp.Null, gosnmp.NoSuchObject, gosnmp.NoSuchInstance, gosnmp.EndOfMibView, gosnmp.UnknownType:
		return true
	}
	return v.Value == nil
}

// toUint le inteiros nao negativos de qualquer tipo numerico do SNMP.
func toUint(v gosnmp.SnmpPDU) (uint64, bool) {
	switch x := v.Value.(type) {
	case uint:
		return uint64(x), true
	case uint8:
		return uint64(x), true
	case uint16:
		return uint64(x), true
	case uint32:
		return uint64(x), true
	case uint64:
		return x, true
	case int:
		if x >= 0 {
			return uint64(x), true
		}
	case int32:
		if x >= 0 {
			return uint64(x), true
		}
	case int64:
		if x >= 0 {
			return uint64(x), true
		}
	}
	return 0, false
}

// toFloat le qualquer valor numerico (inteiros, contadores e floats Opaque).
func toFloat(v gosnmp.SnmpPDU) (float64, bool) {
	switch x := v.Value.(type) {
	case int:
		return float64(x), true
	case int32:
		return float64(x), true
	case int64:
		return float64(x), true
	case float32:
		f := float64(x)
		return f, !math.IsNaN(f) && !math.IsInf(f, 0)
	case float64:
		return x, !math.IsNaN(x) && !math.IsInf(x, 0)
	}
	if u, ok := toUint(v); ok {
		return float64(u), true
	}
	return 0, false
}

// text converte a variavel em texto: OCTET STRING legivel, OID sem ponto inicial, numeros.
func text(v gosnmp.SnmpPDU) string {
	switch x := v.Value.(type) {
	case nil:
		return ""
	case []byte:
		return octets(x)
	case string:
		if v.Type == gosnmp.ObjectIdentifier {
			return normOID(x)
		}
		return x
	}
	if f, ok := toFloat(v); ok {
		if u, uok := toUint(v); uok {
			return strconv.FormatUint(u, 10)
		}
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	return ""
}

// octets devolve o texto quando e UTF-8 legivel; senao os bytes em hexadecimal (ex.: MAC).
func octets(b []byte) string {
	s := strings.TrimRight(string(b), "\x00")
	if utf8.ValidString(s) {
		printable := true
		for _, r := range s {
			if !unicode.IsPrint(r) && !unicode.IsSpace(r) {
				printable = false
				break
			}
		}
		if printable {
			return s
		}
	}
	const hexd = "0123456789abcdef"
	out := make([]byte, 0, len(b)*3)
	for i, c := range b {
		if i > 0 {
			out = append(out, ':')
		}
		out = append(out, hexd[c>>4], hexd[c&0x0f])
	}
	return string(out)
}

// normOID tira o ponto inicial.
func normOID(oid string) string { return strings.TrimPrefix(strings.TrimSpace(oid), ".") }

// suffixIndex extrai o indice da interface do OID retornado por uma coluna.
func suffixIndex(column, name string) (int, bool) {
	col, n := normOID(column)+".", normOID(name)
	if !strings.HasPrefix(n, col) {
		return 0, false
	}
	rest := n[len(col):]
	if strings.Contains(rest, ".") {
		return 0, false
	}
	idx, err := strconv.Atoi(rest)
	if err != nil || idx < 0 {
		return 0, false
	}
	return idx, true
}

// pollTarget coleta um alvo com uma sessao nova, limitada pelo contexto.
func pollTarget(ctx context.Context, dialer func(context.Context, Target) (session, error), t Target, at time.Time) Result {
	s, err := dialer(ctx, t)
	if err != nil {
		msg := err.Error()
		return Result{DeviceID: t.ID, Time: at.UTC().Format(time.RFC3339Nano), Error: &msg}
	}
	defer s.Close()
	return poll(s, t, at)
}
