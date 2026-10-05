package snmp

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/gosnmp/gosnmp"
)

// maxVarbinds e quantos varbinds de cada trap sao encaminhados (o servidor usa ate 100).
const maxVarbinds = 100

// OIDs de cabecalho do trap v2c (SNMPv2-MIB).
const (
	oidSysUpTimeInstance = "1.3.6.1.2.1.1.3.0"
	oidSnmpTrapOID       = "1.3.6.1.6.3.1.1.4.1.0"
	// Prefixo dos traps genericos v1 convertidos (RFC 3584, secao 3.1).
	oidSnmpTraps = "1.3.6.1.6.3.1.1.5."
)

// Trap e um item de POST /api/v3/snmp/traps/.
type Trap struct {
	Time      string    `json:"time"`
	SourceIP  string    `json:"source_ip"`
	Version   string    `json:"version"`
	Community string    `json:"community"`
	TrapOID   string    `json:"trap_oid"`
	Varbinds  []Varbind `json:"varbinds"`
}

// Varbind e uma variavel do trap; value e texto, numero ou booleano.
type Varbind struct {
	OID   string `json:"oid"`
	Type  string `json:"type"`
	Value any    `json:"value"`
}

// convertTrap transforma o pacote recebido no formato do servidor. Traps v3 sao ignorados.
func convertTrap(p *gosnmp.SnmpPacket, from *net.UDPAddr, at time.Time) (Trap, bool) {
	if p == nil || from == nil {
		return Trap{}, false
	}
	t := Trap{Time: at.UTC().Format(time.RFC3339Nano), SourceIP: sourceIP(from), Community: p.Community, Varbinds: []Varbind{}}
	switch p.Version {
	case gosnmp.Version1:
		t.Version = "v1"
		t.TrapOID = v1TrapOID(p.Enterprise, p.GenericTrap, p.SpecificTrap)
	case gosnmp.Version2c:
		t.Version = "v2c"
	default:
		return Trap{}, false
	}
	for _, v := range p.Variables {
		oid := normOID(v.Name)
		if p.Version == gosnmp.Version2c {
			switch oid {
			case oidSnmpTrapOID:
				t.TrapOID = text(v)
				continue
			case oidSysUpTimeInstance:
				continue
			}
		}
		if len(t.Varbinds) < maxVarbinds {
			t.Varbinds = append(t.Varbinds, Varbind{OID: oid, Type: v.Type.String(), Value: varbindValue(v)})
		}
	}
	return t, true
}

// v1TrapOID converte enterprise/generic/specific no OID equivalente do v2c (RFC 3584).
func v1TrapOID(enterprise string, generic, specific int) string {
	if generic >= 0 && generic < 6 {
		return oidSnmpTraps + strconv.Itoa(generic+1)
	}
	return normOID(enterprise) + ".0." + strconv.Itoa(specific)
}

// sourceIP devolve o IP de origem (IPv4 mapeado em IPv6 vira IPv4).
func sourceIP(a *net.UDPAddr) string {
	if ip4 := a.IP.To4(); ip4 != nil {
		return ip4.String()
	}
	return a.IP.String()
}

// varbindValue converte o valor: numeros como numero, o resto como texto.
func varbindValue(v gosnmp.SnmpPDU) any {
	if isEmpty(v) {
		return ""
	}
	switch x := v.Value.(type) {
	case bool:
		return x
	case []byte, string:
		return text(v)
	}
	if u, ok := toUint(v); ok {
		return u
	}
	if f, ok := toFloat(v); ok {
		return f
	}
	return text(v)
}

// trapServer e o receptor de traps na porta UDP configurada.
type trapServer struct {
	port int
	tl   *gosnmp.TrapListener
	dead atomic.Bool
}

// startTrapServer escuta UDP em port (todas as interfaces) e chama onTrap a cada trap v1/v2c.
// Devolve erro quando a porta esta em uso ou exige privilegio.
func startTrapServer(port int, onTrap func(Trap)) (*trapServer, error) {
	return startTrapServerAddr(":"+strconv.Itoa(port), port, onTrap)
}

func startTrapServerAddr(addr string, port int, onTrap func(Trap)) (*trapServer, error) {
	tl := gosnmp.NewTrapListener()
	// Sessao propria (nao a gosnmp.Default) e sem credenciais v3: traps v3 sao descartados.
	tl.Params = &gosnmp.GoSNMP{Version: gosnmp.Version2c, Transport: "udp"}
	tl.OnNewTrap = func(p *gosnmp.SnmpPacket, from *net.UDPAddr) {
		defer func() { _ = recover() }()
		if t, ok := convertTrap(p, from, time.Now()); ok {
			onTrap(t)
		}
	}
	ts := &trapServer{port: port, tl: tl}
	errc := make(chan error, 1)
	go func() {
		defer func() {
			if p := recover(); p != nil {
				ts.dead.Store(true)
				errc <- fmt.Errorf("receptor de traps: falha interna: %v", p)
			}
		}()
		err := tl.Listen(addr)
		ts.dead.Store(true)
		if err == nil {
			err = errors.New("receptor de traps encerrado")
		}
		errc <- err
	}()
	select {
	case <-tl.Listening():
		return ts, nil
	case err := <-errc:
		return nil, err
	}
}

// alive informa se o receptor continua escutando.
func (t *trapServer) alive() bool { return t != nil && !t.dead.Load() }

// stop fecha a porta.
func (t *trapServer) stop() {
	if t == nil {
		return
	}
	t.dead.Store(true)
	t.tl.Close()
}
