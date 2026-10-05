//go:build windows

package wua

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"strings"

	ole "github.com/go-ole/go-ole"
	"github.com/go-ole/go-ole/oleutil"
)

// sFalse e o HRESULT S_FALSE: o COM ja estava inicializado nesta thread.
const sFalse = 1

// errNoResult e devolvido por runCOM quando o tempo acaba antes do fim da operacao.
var errNoResult = errors.New("tempo limite excedido aguardando o Windows Update")

// runCOM executa fn em uma goroutine presa a uma thread do sistema com o COM inicializado
// (MTA). As chamadas do WUA sao sincronas e nao podem ser canceladas: se ctx acabar, runCOM
// devolve erro, mas fn continua ate o WUA responder; done e fechado so no fim real de fn,
// para que o chamador possa segurar a trava ate la.
func runCOM(ctx context.Context, fn func() error) (done <-chan struct{}, err error) {
	finished := make(chan struct{})
	result := make(chan error, 1)
	go func() {
		defer close(finished)
		defer func() {
			if p := recover(); p != nil {
				result <- fmt.Errorf("falha interna no COM: %v", p)
			}
		}()
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		if err := ole.CoInitializeEx(0, ole.COINIT_MULTITHREADED); err != nil && hresult(err) != sFalse {
			result <- fmt.Errorf("falha ao inicializar o COM: %w", err)
			return
		}
		defer ole.CoUninitialize()
		result <- fn()
	}()
	select {
	case err = <-result:
		return finished, err
	case <-ctx.Done():
		return finished, fmt.Errorf("%w: %v", errNoResult, ctx.Err())
	}
}

// hresult extrai o codigo HRESULT de um erro do go-ole (preferindo o SCODE da excecao).
func hresult(err error) uint32 {
	var oe *ole.OleError
	if !errors.As(err, &oe) {
		return 0
	}
	if ex, ok := oe.SubError().(ole.EXCEPINFO); ok && ex.SCODE() != 0 {
		return ex.SCODE()
	}
	return uint32(oe.Code())
}

// comErr formata um erro do COM com o HRESULT em hexadecimal (facilita a busca do codigo WU_E_*).
func comErr(op string, err error) error {
	if err == nil {
		return nil
	}
	if hr := hresult(err); hr != 0 {
		return fmt.Errorf("%s: 0x%08X (%v)", op, hr, err)
	}
	return fmt.Errorf("%s: %w", op, err)
}

// createDispatch cria um objeto COM pelo ProgID e devolve a interface IDispatch.
func createDispatch(progID string) (*ole.IDispatch, error) {
	unk, err := oleutil.CreateObject(progID)
	if err != nil {
		return nil, comErr("criar "+progID, err)
	}
	defer unk.Release()
	disp, err := unk.QueryInterface(ole.IID_IDispatch)
	if err != nil {
		return nil, comErr("IDispatch de "+progID, err)
	}
	return disp, nil
}

// getDisp le uma propriedade que e objeto. O chamador libera com Release.
func getDisp(d *ole.IDispatch, name string, params ...any) (*ole.IDispatch, error) {
	v, err := oleutil.GetProperty(d, name, params...)
	if err != nil {
		return nil, comErr(name, err)
	}
	disp := v.ToIDispatch()
	if disp == nil {
		v.Clear()
		return nil, fmt.Errorf("%s: valor nao e objeto", name)
	}
	return disp, nil
}

// callDisp chama um metodo que devolve objeto. O chamador libera com Release.
func callDisp(d *ole.IDispatch, name string, params ...any) (*ole.IDispatch, error) {
	v, err := oleutil.CallMethod(d, name, params...)
	if err != nil {
		return nil, comErr(name, err)
	}
	disp := v.ToIDispatch()
	if disp == nil {
		v.Clear()
		return nil, fmt.Errorf("%s: valor nao e objeto", name)
	}
	return disp, nil
}

// callVoid chama um metodo cujo retorno nao interessa.
func callVoid(d *ole.IDispatch, name string, params ...any) error {
	v, err := oleutil.CallMethod(d, name, params...)
	if err != nil {
		return comErr(name, err)
	}
	v.Clear()
	return nil
}

// getValue le uma propriedade simples e libera o VARIANT.
func getValue(d *ole.IDispatch, name string, params ...any) (any, error) {
	v, err := oleutil.GetProperty(d, name, params...)
	if err != nil {
		return nil, comErr(name, err)
	}
	defer v.Clear()
	return v.Value(), nil
}

func getString(d *ole.IDispatch, name string) string {
	val, err := getValue(d, name)
	if err != nil {
		return ""
	}
	s, _ := val.(string)
	return s
}

func getBool(d *ole.IDispatch, name string) bool {
	val, err := getValue(d, name)
	if err != nil {
		return false
	}
	b, _ := val.(bool)
	return b
}

func getInt(d *ole.IDispatch, name string) (int, error) {
	val, err := getValue(d, name)
	if err != nil {
		return 0, err
	}
	return toInt(val), nil
}

func toInt(v any) int {
	switch x := v.(type) {
	case int:
		return x
	case int8:
		return int(x)
	case int16:
		return int(x)
	case int32:
		return int(x)
	case int64:
		return int(x)
	case uint8:
		return int(x)
	case uint16:
		return int(x)
	case uint32:
		return int(x)
	case uint64:
		return int(x)
	}
	return 0
}

// putObject atribui um objeto a uma propriedade. Tenta propput e, se o objeto recusar,
// propputref (o "Set obj.Prop = valor" dos exemplos em VBScript).
func putObject(d *ole.IDispatch, name string, value *ole.IDispatch) error {
	v, err := oleutil.PutProperty(d, name, value)
	if err == nil {
		v.Clear()
		return nil
	}
	v, err2 := oleutil.PutPropertyRef(d, name, value)
	if err2 != nil {
		return comErr("atribuir "+name, err)
	}
	v.Clear()
	return nil
}

// putValue atribui um valor simples, ignorando falhas (propriedades opcionais).
func putValue(d *ole.IDispatch, name string, value any) {
	if v, err := oleutil.PutProperty(d, name, value); err == nil {
		v.Clear()
	}
}

// forEachItem percorre uma colecao WUA (Count + Item(i)). fn nao deve guardar o item:
// ele e liberado logo depois.
func forEachItem(coll *ole.IDispatch, fn func(i int, item *ole.IDispatch) error) error {
	n, err := getInt(coll, "Count")
	if err != nil {
		return err
	}
	for i := 0; i < n; i++ {
		item, err := getDisp(coll, "Item", i)
		if err != nil {
			return err
		}
		ferr := fn(i, item)
		item.Release()
		if ferr != nil {
			return ferr
		}
	}
	return nil
}

// stringList le uma propriedade IStringCollection como []string (falhas viram lista vazia).
func stringList(d *ole.IDispatch, name string) []string {
	coll, err := getDisp(d, name)
	if err != nil {
		return []string{}
	}
	defer coll.Release()
	n, err := getInt(coll, "Count")
	if err != nil {
		return []string{}
	}
	out := make([]string, 0, n)
	for i := 0; i < n; i++ {
		val, err := getValue(coll, "Item", i)
		if err != nil {
			continue
		}
		if s, ok := val.(string); ok && strings.TrimSpace(s) != "" {
			out = append(out, strings.TrimSpace(s))
		}
	}
	return out
}
