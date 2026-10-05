//go:build windows

package winsys

import (
	"errors"
	"fmt"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

var (
	modAdvapi32        = windows.NewLazySystemDLL("advapi32.dll")
	procRegDeleteTreeW = modAdvapi32.NewProc("RegDeleteTreeW")
	procRegRenameKey   = modAdvapi32.NewProc("RegRenameKey")
	procRegCopyTreeW   = modAdvapi32.NewProc("RegCopyTreeW")
	procRegSetValueExW = modAdvapi32.NewProc("RegSetValueExW")
)

// wow64 garante a visao nativa (64 bits) mesmo com o agente de 32 bits num Windows de 64 bits.
const wow64 = registry.WOW64_64KEY

func rootKey(r Root) registry.Key {
	switch r {
	case HKCR:
		return registry.CLASSES_ROOT
	case HKCU:
		return registry.CURRENT_USER
	case HKU:
		return registry.USERS
	case HKCC:
		return registry.CURRENT_CONFIG
	}
	return registry.LOCAL_MACHINE
}

// regError traduz os erros mais comuns do registro.
func regError(err error, what string) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, windows.ERROR_FILE_NOT_FOUND), errors.Is(err, windows.ERROR_PATH_NOT_FOUND):
		return fmt.Errorf("%s nao encontrado(a)", what)
	case errors.Is(err, windows.ERROR_ACCESS_DENIED):
		return fmt.Errorf("acesso negado: %s", what)
	case errors.Is(err, windows.ERROR_KEY_DELETED):
		return fmt.Errorf("a chave foi excluida: %s", what)
	}
	return fmt.Errorf("%s: %v", what, err)
}

func openKey(p RegPath, access uint32) (registry.Key, error) {
	k, err := registry.OpenKey(rootKey(p.Root), p.Sub, access|wow64)
	if err != nil {
		return 0, regError(err, "chave "+p.String())
	}
	return k, nil
}

// RegBrowse lista subchaves e valores de path, paginados (subchaves antes dos valores).
func RegBrowse(path string, page, size int) (RegListing, error) {
	p, err := ParseRegPath(path)
	if errors.Is(err, ErrRootListing) {
		return RootListing(), nil
	}
	if err != nil {
		return RegListing{}, err
	}
	k, err := openKey(p, registry.QUERY_VALUE|registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return RegListing{}, err
	}
	defer k.Close()
	keys, err := k.ReadSubKeyNames(-1)
	if err != nil && len(keys) == 0 {
		return RegListing{}, regError(err, "subchaves de "+p.String())
	}
	names, err := k.ReadValueNames(-1)
	if err != nil && len(names) == 0 {
		names = nil
	}
	SortNames(keys)
	SortNames(names)
	ks, ke, vs, ve, more := PageWindow(len(keys), len(names), page, size)

	out := RegListing{Path: p.String(), Subkeys: make([]RegSubkey, 0, ke-ks), Values: make([]RegValue, 0, ve-vs), HasMore: more}
	for _, name := range keys[ks:ke] {
		out.Subkeys = append(out.Subkeys, RegSubkey{Name: name, HasSubkeys: hasSubkeys(k, name)})
	}
	for _, name := range names[vs:ve] {
		t, raw, err := readRaw(k, name)
		if err != nil {
			out.Values = append(out.Values, RegValue{Name: name, Type: "REG_NONE", Data: "(erro ao ler: " + err.Error() + ")"})
			continue
		}
		out.Values = append(out.Values, RegValue{Name: name, Type: RegTypeName(t), Data: FormatRegValue(t, raw)})
	}
	return out, nil
}

func hasSubkeys(parent registry.Key, name string) bool {
	k, err := registry.OpenKey(parent, name, registry.QUERY_VALUE|wow64)
	if err != nil {
		return false
	}
	defer k.Close()
	st, err := k.Stat()
	return err == nil && st.SubKeyCount > 0
}

// readRaw le o conteudo cru de um valor, repetindo enquanto o tamanho mudar.
func readRaw(k registry.Key, name string) (uint32, []byte, error) {
	buf := make([]byte, 256)
	for i := 0; i < 5; i++ {
		n, t, err := k.GetValue(name, buf)
		if err == nil {
			return t, buf[:n], nil
		}
		if !errors.Is(err, registry.ErrShortBuffer) || n <= len(buf) {
			return 0, nil, err
		}
		buf = make([]byte, n)
	}
	return 0, nil, errors.New("o valor mudou de tamanho durante a leitura")
}

// RegCreateKey cria a chave (e as intermediarias). Falha se ja existir.
func RegCreateKey(path string) error {
	p, err := parseKeyPath(path)
	if err != nil {
		return err
	}
	k, existed, err := registry.CreateKey(rootKey(p.Root), p.Sub, registry.CREATE_SUB_KEY|registry.QUERY_VALUE|wow64)
	if err != nil {
		return regError(err, "chave "+p.String())
	}
	k.Close()
	if existed {
		return fmt.Errorf("a chave ja existe: %s", p.String())
	}
	return nil
}

// RegDeleteKey exclui a chave com todas as subchaves.
func RegDeleteKey(path string) error {
	p, err := parseKeyPath(path)
	if err != nil {
		return err
	}
	parent, leaf, _ := p.Parent()
	pk, done, err := openParent(parent)
	if err != nil {
		return err
	}
	defer done()
	// Confirma que existe para dar uma mensagem clara.
	if k, err := registry.OpenKey(pk, leaf, registry.QUERY_VALUE|wow64); err != nil {
		return regError(err, "chave "+p.String())
	} else {
		k.Close()
	}
	return regError(deleteTree(pk, leaf), "chave "+p.String())
}

// openParent abre a chave pai com acesso total; quando o pai e a colmeia, devolve a propria colmeia.
func openParent(parent RegPath) (registry.Key, func(), error) {
	if parent.Sub == "" {
		return rootKey(parent.Root), func() {}, nil
	}
	k, err := openKey(parent, registry.ALL_ACCESS)
	if err != nil {
		return 0, nil, err
	}
	return k, func() { k.Close() }, nil
}

func deleteTree(parent registry.Key, leaf string) error {
	if err := procRegDeleteTreeW.Find(); err != nil {
		return err
	}
	name, err := windows.UTF16PtrFromString(leaf)
	if err != nil {
		return err
	}
	r, _, _ := procRegDeleteTreeW.Call(uintptr(parent), uintptr(unsafe.Pointer(name)))
	if r != 0 {
		return windows.Errno(r)
	}
	return nil
}

// RegRenameKey renomeia a chave. Na mesma chave pai usa RegRenameKey; em outro lugar copia e exclui.
func RegRenameKey(oldPath, newPath string) error {
	from, err := parseKeyPath(oldPath)
	if err != nil {
		return err
	}
	to, err := parseKeyPath(newPath)
	if err != nil {
		return err
	}
	if strings.EqualFold(from.String(), to.String()) {
		return nil
	}
	if k, err := openKey(to, registry.QUERY_VALUE); err == nil {
		k.Close()
		return fmt.Errorf("ja existe uma chave com esse nome: %s", to.String())
	}
	fromParent, fromLeaf, _ := from.Parent()
	toParent, toLeaf, _ := to.Parent()
	if fromParent.Root == toParent.Root && strings.EqualFold(fromParent.Sub, toParent.Sub) && procRegRenameKey.Find() == nil {
		pk, done, err := openParent(fromParent)
		if err != nil {
			return err
		}
		defer done()
		oldName, err := windows.UTF16PtrFromString(fromLeaf)
		if err != nil {
			return err
		}
		newName, err := windows.UTF16PtrFromString(toLeaf)
		if err != nil {
			return err
		}
		r, _, _ := procRegRenameKey.Call(uintptr(pk), uintptr(unsafe.Pointer(oldName)), uintptr(unsafe.Pointer(newName)))
		if r != 0 {
			return regError(windows.Errno(r), "chave "+from.String())
		}
		return nil
	}
	// Copia a arvore para o destino e exclui a origem.
	if err := procRegCopyTreeW.Find(); err != nil {
		return err
	}
	src, err := openKey(from, registry.READ)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, _, err := registry.CreateKey(rootKey(to.Root), to.Sub, registry.ALL_ACCESS|wow64)
	if err != nil {
		return regError(err, "chave "+to.String())
	}
	r, _, _ := procRegCopyTreeW.Call(uintptr(src), 0, uintptr(dst))
	dst.Close()
	if r != 0 {
		return regError(windows.Errno(r), "copia de "+from.String())
	}
	pk, done, err := openParent(fromParent)
	if err != nil {
		return err
	}
	defer done()
	return regError(deleteTree(pk, fromLeaf), "chave "+from.String())
}

// RegSetValue grava um valor. Com create, falha se o valor ja existir.
func RegSetValue(path, name, typeName, data string, create bool) error {
	p, err := ParseRegPath(path)
	if err != nil {
		if errors.Is(err, ErrRootListing) {
			return errors.New("informe a chave do valor")
		}
		return err
	}
	v, err := ParseRegValue(typeName, data)
	if err != nil {
		return err
	}
	k, err := openKey(p, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	if create {
		if _, _, err := k.GetValue(name, nil); err == nil || errors.Is(err, registry.ErrShortBuffer) {
			return fmt.Errorf("o valor ja existe: %s", valueLabel(name))
		}
	}
	return regError(setRaw(k, name, v.Type, v.Encode()), "valor "+valueLabel(name))
}

func setRaw(k registry.Key, name string, t uint32, data []byte) error {
	if err := procRegSetValueExW.Find(); err != nil {
		return err
	}
	n, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return err
	}
	var ptr *byte
	if len(data) > 0 {
		ptr = &data[0]
	}
	r, _, _ := procRegSetValueExW.Call(uintptr(k), uintptr(unsafe.Pointer(n)), 0, uintptr(t), uintptr(unsafe.Pointer(ptr)), uintptr(len(data)))
	if r != 0 {
		return windows.Errno(r)
	}
	return nil
}

// RegRenameValue copia o valor (mesmo tipo e conteudo) para o novo nome e exclui o antigo.
func RegRenameValue(path, oldName, newName string) error {
	p, err := ParseRegPath(path)
	if err != nil {
		if errors.Is(err, ErrRootListing) {
			return errors.New("informe a chave do valor")
		}
		return err
	}
	if oldName == newName {
		return nil
	}
	k, err := openKey(p, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	t, raw, err := readRaw(k, oldName)
	if err != nil {
		return regError(err, "valor "+valueLabel(oldName))
	}
	if _, _, err := k.GetValue(newName, nil); err == nil || errors.Is(err, registry.ErrShortBuffer) {
		if !strings.EqualFold(oldName, newName) {
			return fmt.Errorf("ja existe um valor com esse nome: %s", valueLabel(newName))
		}
	}
	if strings.EqualFold(oldName, newName) {
		// Nomes de valor nao diferenciam maiusculas: exclui antes para trocar so a grafia.
		if err := k.DeleteValue(oldName); err != nil {
			return regError(err, "valor "+valueLabel(oldName))
		}
		return regError(setRaw(k, newName, t, raw), "valor "+valueLabel(newName))
	}
	if err := setRaw(k, newName, t, raw); err != nil {
		return regError(err, "valor "+valueLabel(newName))
	}
	return regError(k.DeleteValue(oldName), "valor "+valueLabel(oldName))
}

// RegDeleteValue exclui um valor.
func RegDeleteValue(path, name string) error {
	p, err := ParseRegPath(path)
	if err != nil {
		if errors.Is(err, ErrRootListing) {
			return errors.New("informe a chave do valor")
		}
		return err
	}
	k, err := openKey(p, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	return regError(k.DeleteValue(name), "valor "+valueLabel(name))
}

// parseKeyPath exige uma subchave (nao aceita a raiz nem a propria colmeia).
func parseKeyPath(path string) (RegPath, error) {
	p, err := ParseRegPath(path)
	if err != nil {
		if errors.Is(err, ErrRootListing) {
			return RegPath{}, errors.New("informe o caminho da chave")
		}
		return RegPath{}, err
	}
	if p.Sub == "" {
		return RegPath{}, errors.New("nao e possivel alterar uma colmeia raiz")
	}
	return p, nil
}

func valueLabel(name string) string {
	if name == "" {
		return "(Padrao)"
	}
	return name
}
