//go:build windows

package winevt

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// API do Log de Eventos do Windows (wevtapi.dll, Windows Vista ou superior).
var (
	modWevtapi                   = windows.NewLazySystemDLL("wevtapi.dll")
	procEvtQuery                 = modWevtapi.NewProc("EvtQuery")
	procEvtNext                  = modWevtapi.NewProc("EvtNext")
	procEvtClose                 = modWevtapi.NewProc("EvtClose")
	procEvtCreateRenderContext   = modWevtapi.NewProc("EvtCreateRenderContext")
	procEvtRender                = modWevtapi.NewProc("EvtRender")
	procEvtOpenPublisherMetadata = modWevtapi.NewProc("EvtOpenPublisherMetadata")
	procEvtFormatMessage         = modWevtapi.NewProc("EvtFormatMessage")
)

const (
	evtQueryChannelPath         = 0x1
	evtQueryForwardDirection    = 0x100
	evtQueryReverseDirection    = 0x200
	evtQueryTolerateQueryErrors = 0x1000

	evtRenderContextSystem = 1
	evtRenderEventValues   = 0
	evtRenderEventXML      = 1

	evtFormatMessageEvent = 1

	// Indices de EVT_SYSTEM_PROPERTY_ID.
	sysProviderName = 0
	sysEventID      = 2
	sysLevel        = 4
	sysKeywords     = 7
	sysTimeCreated  = 8
	sysRecordID     = 9
	sysChannel      = 14
	sysComputer     = 15

	// Tipos de EVT_VARIANT.
	varString   = 1
	varByte     = 4
	varUInt16   = 6
	varUInt32   = 8
	varUInt64   = 10
	varFileTime = 17
	varHexInt32 = 20
	varHexInt64 = 21

	evtVariantSize = 16 // uniao de 8 bytes + Count + Type, em 32 e 64 bits

	errNoMoreItems             = windows.Errno(259)
	errInsufficientBuffer      = windows.ERROR_INSUFFICIENT_BUFFER
	errEvtChannelNotFound      = windows.Errno(15007)
	errEvtInvalidQuery         = windows.Errno(15001)
	errEvtUnresolvedValue      = windows.Errno(15029)
	errEvtUnresolvedParameter  = windows.Errno(15030)
	errEvtMaxInsertsReached    = windows.Errno(15031)
	keywordAuditFailure        = 0x0010000000000000
	keywordAuditSuccess        = 0x0020000000000000
	queryBudget                = 80 * time.Second
	maxMessage                 = 8 << 10
	batchSize                  = 64
	infinite                   = 0xFFFFFFFF
	defaultRenderBuffer        = 4096
	defaultFormatBufferInChars = 2048
)

type evtHandle uintptr

func evtClose(h evtHandle) {
	if h != 0 {
		_, _, _ = procEvtClose.Call(uintptr(h))
	}
}

func query(logName string, since time.Time, max int) ([]Event, error) {
	xpath := "*"
	if !since.IsZero() {
		ms := time.Since(since).Milliseconds()
		if ms < 0 {
			ms = 0
		}
		xpath = fmt.Sprintf("*[System[TimeCreated[timediff(@SystemTime) <= %d]]]", ms)
	}
	return run(logName, xpath, evtQueryReverseDirection, max, true)
}

func queryAfter(logName string, after uint64, max int) ([]Event, error) {
	return run(logName, fmt.Sprintf("*[System[(EventRecordID > %d)]]", after), evtQueryForwardDirection, max, true)
}

func lastRecord(logName string) (uint64, error) {
	evs, err := run(logName, "*", evtQueryReverseDirection, 1, false)
	if err != nil || len(evs) == 0 {
		return 0, err
	}
	return evs[0].RecordID, nil
}

// run executa a consulta XPath e renderiza os eventos, no maximo max (0 = sem limite).
// Com consultas muito longas, devolve o que conseguiu ler dentro de queryBudget.
// Sem withMessage, a mensagem (a parte mais cara) nao e formatada.
func run(logName, xpath string, flags uint32, max int, withMessage bool) ([]Event, error) {
	if err := modWevtapi.Load(); err != nil {
		return nil, fmt.Errorf("wevtapi.dll indisponivel: %w", err)
	}
	if logName == "" {
		return nil, errors.New("informe o nome do log")
	}
	path, err := windows.UTF16PtrFromString(logName)
	if err != nil {
		return nil, err
	}
	q, err := windows.UTF16PtrFromString(xpath)
	if err != nil {
		return nil, err
	}
	r, _, callErr := procEvtQuery.Call(0, uintptr(unsafe.Pointer(path)), uintptr(unsafe.Pointer(q)),
		uintptr(evtQueryChannelPath|evtQueryTolerateQueryErrors|flags))
	if r == 0 {
		switch {
		case errors.Is(callErr, errEvtChannelNotFound):
			return nil, fmt.Errorf("log de eventos nao encontrado: %s", logName)
		case errors.Is(callErr, windows.ERROR_ACCESS_DENIED):
			return nil, fmt.Errorf("acesso negado ao log %s", logName)
		case errors.Is(callErr, errEvtInvalidQuery):
			return nil, fmt.Errorf("consulta invalida no log %s", logName)
		}
		return nil, fmt.Errorf("falha ao consultar o log %s: %v", logName, callErr)
	}
	results := evtHandle(r)
	defer evtClose(results)

	rc, _, callErr := procEvtCreateRenderContext.Call(0, 0, evtRenderContextSystem)
	if rc == 0 {
		return nil, fmt.Errorf("falha ao criar o contexto de renderizacao: %v", callErr)
	}
	renderCtx := evtHandle(rc)
	defer evtClose(renderCtx)

	r2 := &renderer{ctx: renderCtx, publishers: map[string]evtHandle{}, withMessage: withMessage}
	defer r2.close()

	deadline := time.Now().Add(queryBudget)
	out := make([]Event, 0, 64)
	handles := make([]evtHandle, batchSize)
	for {
		var returned uint32
		ok, _, callErr := procEvtNext.Call(uintptr(results), batchSize, uintptr(unsafe.Pointer(&handles[0])), infinite, 0,
			uintptr(unsafe.Pointer(&returned)))
		if ok == 0 {
			if errors.Is(callErr, errNoMoreItems) || len(out) > 0 {
				break
			}
			return nil, fmt.Errorf("falha ao ler o log %s: %v", logName, callErr)
		}
		stop := false
		for i := uint32(0); i < returned; i++ {
			h := handles[i]
			if !stop {
				if ev, err := r2.event(h); err == nil {
					out = append(out, ev)
				}
				if (max > 0 && len(out) >= max) || time.Now().After(deadline) {
					stop = true
				}
			}
			evtClose(h)
		}
		if stop {
			break
		}
	}
	return out, nil
}

type renderer struct {
	ctx         evtHandle
	buf         []uint64 // alinhado em 8 bytes para os EVT_VARIANT
	publishers  map[string]evtHandle
	withMessage bool
}

func (r *renderer) close() {
	for _, h := range r.publishers {
		evtClose(h)
	}
}

// render chama EvtRender aumentando o buffer quando necessario. Devolve os bytes usados.
func (r *renderer) render(ctx, ev evtHandle, flags uint32) ([]byte, uint32, error) {
	if len(r.buf) == 0 {
		r.buf = make([]uint64, defaultRenderBuffer/8)
	}
	for i := 0; i < 4; i++ {
		var used, count uint32
		ok, _, callErr := procEvtRender.Call(uintptr(ctx), uintptr(ev), uintptr(flags), uintptr(len(r.buf)*8),
			uintptr(unsafe.Pointer(&r.buf[0])), uintptr(unsafe.Pointer(&used)), uintptr(unsafe.Pointer(&count)))
		if ok != 0 {
			b := unsafe.Slice((*byte)(unsafe.Pointer(&r.buf[0])), len(r.buf)*8)
			return b[:used], count, nil
		}
		if !errors.Is(callErr, errInsufficientBuffer) {
			return nil, 0, callErr
		}
		r.buf = make([]uint64, used/8+1)
	}
	return nil, 0, errInsufficientBuffer
}

func (r *renderer) event(h evtHandle) (Event, error) {
	b, count, err := r.render(r.ctx, h, evtRenderEventValues)
	if err != nil {
		return Event{}, err
	}
	v := variants{b: b, n: int(count)}
	ev := Event{
		Source:   v.str(sysProviderName),
		EventID:  int(v.uint(sysEventID)),
		Level:    int(v.uint(sysLevel)),
		RecordID: v.uint(sysRecordID),
		Log:      v.str(sysChannel),
		Host:     v.str(sysComputer),
	}
	if ft := v.uint(sysTimeCreated); ft != 0 {
		f := windows.Filetime{LowDateTime: uint32(ft), HighDateTime: uint32(ft >> 32)}
		ev.Time = time.Unix(0, f.Nanoseconds())
	}
	ev.Type = typeOf(ev.Level, v.uint(sysKeywords))
	if r.withMessage {
		ev.Message = r.message(h, ev.Source)
	}
	return ev, nil
}

// typeOf converte nivel e palavras-chave no tipo usado pelo console.
func typeOf(level int, keywords uint64) string {
	switch {
	case keywords&keywordAuditFailure != 0:
		return "AUDIT_FAILURE"
	case keywords&keywordAuditSuccess != 0:
		return "AUDIT_SUCCESS"
	}
	switch level {
	case 1:
		return "CRITICAL"
	case 2:
		return "ERROR"
	case 3:
		return "WARNING"
	}
	return "INFO"
}

// variants le o vetor de EVT_VARIANT devolvido por EvtRender.
type variants struct {
	b []byte
	n int
}

func (v variants) at(i int) (off int, typ uint32, ok bool) {
	off = i * evtVariantSize
	if i >= v.n || off+evtVariantSize > len(v.b) {
		return 0, 0, false
	}
	typ = *(*uint32)(unsafe.Pointer(&v.b[off+12])) & 0x7F // sem o bit de vetor
	return off, typ, true
}

func (v variants) str(i int) string {
	off, typ, ok := v.at(i)
	if !ok || typ != varString {
		return ""
	}
	p := *(**uint16)(unsafe.Pointer(&v.b[off]))
	if p == nil {
		return ""
	}
	return windows.UTF16PtrToString(p)
}

func (v variants) uint(i int) uint64 {
	off, typ, ok := v.at(i)
	if !ok {
		return 0
	}
	switch typ {
	case varByte:
		return uint64(v.b[off])
	case varUInt16:
		return uint64(*(*uint16)(unsafe.Pointer(&v.b[off])))
	case varUInt32, varHexInt32:
		return uint64(*(*uint32)(unsafe.Pointer(&v.b[off])))
	case varUInt64, varHexInt64, varFileTime:
		return *(*uint64)(unsafe.Pointer(&v.b[off]))
	}
	return 0
}

// publisher abre (e guarda) os metadados do provedor; 0 quando nao registrado.
func (r *renderer) publisher(name string) evtHandle {
	if h, ok := r.publishers[name]; ok {
		return h
	}
	var h evtHandle
	if p, err := windows.UTF16PtrFromString(name); err == nil && name != "" {
		ret, _, _ := procEvtOpenPublisherMetadata.Call(0, uintptr(unsafe.Pointer(p)), 0, 0, 0)
		h = evtHandle(ret)
	}
	r.publishers[name] = h
	return h
}

// message formata a mensagem do evento; sem metadados do provedor, monta o texto com os dados do evento.
func (r *renderer) message(ev evtHandle, source string) string {
	if pub := r.publisher(source); pub != 0 {
		if msg, ok := formatMessage(pub, ev); ok {
			return clip(msg)
		}
	}
	return clip(r.eventData(ev))
}

func formatMessage(pub, ev evtHandle) (string, bool) {
	buf := make([]uint16, defaultFormatBufferInChars)
	for i := 0; i < 4; i++ {
		var used uint32
		ok, _, callErr := procEvtFormatMessage.Call(uintptr(pub), uintptr(ev), 0, 0, 0, evtFormatMessageEvent,
			uintptr(len(buf)), uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&used)))
		if ok != 0 {
			return strings.TrimSpace(windows.UTF16ToString(buf)), true
		}
		switch {
		case errors.Is(callErr, errInsufficientBuffer):
			if int(used) <= len(buf) {
				return "", false
			}
			buf = make([]uint16, used)
			continue
		case errors.Is(callErr, errEvtUnresolvedValue), errors.Is(callErr, errEvtUnresolvedParameter), errors.Is(callErr, errEvtMaxInsertsReached):
			// Mensagem formatada parcialmente: ainda e util.
			if used > 0 && int(used) <= len(buf) {
				return strings.TrimSpace(windows.UTF16ToString(buf)), true
			}
		}
		return "", false
	}
	return "", false
}

// eventData renderiza o XML do evento e junta os campos de EventData/UserData.
func (r *renderer) eventData(ev evtHandle) string {
	b, _, err := r.render(0, ev, evtRenderEventXML)
	if err != nil || len(b) < 2 {
		return ""
	}
	u := unsafe.Slice((*uint16)(unsafe.Pointer(&b[0])), len(b)/2)
	return dataFromXML(windows.UTF16ToString(u))
}

func clip(s string) string {
	if len(s) <= maxMessage {
		return s
	}
	i := maxMessage
	for i > 0 && (s[i]&0xC0) == 0x80 {
		i--
	}
	return s[:i] + "..."
}
