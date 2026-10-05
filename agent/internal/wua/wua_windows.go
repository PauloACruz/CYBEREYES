//go:build windows

package wua

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	ole "github.com/go-ole/go-ole"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
)

// Register registra getwinupdates e installwinupdates. A varredura periodica fica com o
// servidor: cada POST /api/v3/checkin/ em Windows publica getwinupdates (secao 3.4).
func Register(e *env.Env) error {
	s := newService(e, &comBackend{})
	s.register(e.Reg)
	return nil
}

// Criterios de busca do WUA (sintaxe documentada em IUpdateSearcher::Search).
const (
	criteriaPending   = "IsInstalled=0 and IsHidden=0"
	criteriaInstalled = "IsInstalled=1"
	// Na instalacao entram tambem as ocultas: o administrador aprovou o GUID explicitamente.
	criteriaInstall = "IsInstalled=0"
)

// OperationResultCode do WUA.
const (
	orcSucceeded           = 2
	orcSucceededWithErrors = 3
)

const clientAppID = "Cybereyes EYES"

// comBackend fala com o Windows Update Agent por IDispatch (Microsoft.Update.Session).
type comBackend struct {
	// mu e segurado ate o fim real da chamada COM, mesmo quando o chamador desiste por tempo
	// limite: assim duas operacoes no WUA nunca rodam juntas.
	mu sync.Mutex
}

// run executa fn no COM e libera a trava so quando fn termina de fato.
func (b *comBackend) run(ctx context.Context, fn func() error) error {
	b.mu.Lock()
	done, err := runCOM(ctx, fn)
	select {
	case <-done:
		b.mu.Unlock()
	default:
		go func() {
			<-done
			b.mu.Unlock()
		}()
	}
	return err
}

func (b *comBackend) Scan(ctx context.Context) (pending, installed []Update, err error) {
	err = b.run(ctx, func() error {
		session, err := newSession()
		if err != nil {
			return err
		}
		defer session.Release()
		pending, err = search(session, criteriaPending)
		if err != nil {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		// A lista de instaladas e complementar (historico no console): falha aqui nao derruba a varredura.
		if inst, ierr := search(session, criteriaInstalled); ierr == nil {
			installed = inst
		}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return pending, installed, nil
}

func (b *comBackend) Install(ctx context.Context, guids []string, report func(InstallResult)) (bool, error) {
	// atomic: a thread do COM pode continuar escrevendo depois de um tempo limite.
	var reboot atomic.Bool
	err := b.run(ctx, func() error {
		session, err := newSession()
		if err != nil {
			return err
		}
		defer session.Release()

		searcher, err := callDisp(session, "CreateUpdateSearcher")
		if err != nil {
			return err
		}
		defer searcher.Release()
		result, err := callDisp(searcher, "Search", criteriaInstall)
		if err != nil {
			return comErr("busca de atualizacoes para instalar", err)
		}
		defer result.Release()
		if code, _ := getInt(result, "ResultCode"); code != orcSucceeded && code != orcSucceededWithErrors {
			return fmt.Errorf("busca de atualizacoes para instalar terminou com codigo %d", code)
		}
		coll, err := getDisp(result, "Updates")
		if err != nil {
			return err
		}
		defer coll.Release()

		// Indice GUID -> posicao na colecao.
		type ref struct {
			guid string
			idx  int
		}
		var refs []ref
		_ = forEachItem(coll, func(i int, u *ole.IDispatch) error {
			if id, err := getDisp(u, "Identity"); err == nil {
				refs = append(refs, ref{guid: getString(id, "UpdateID"), idx: i})
				id.Release()
			}
			return nil
		})
		found, missing := filterByGUID(refs, func(r ref) string { return r.guid }, guids)
		want := map[string]string{}
		for _, g := range guids {
			want[normGUID(g)] = g
		}

		for _, r := range found {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			u, err := getDisp(coll, "Item", r.idx)
			if err != nil {
				report(InstallResult{GUID: want[normGUID(r.guid)], Detail: err.Error()})
				continue
			}
			res := installOne(ctx, session, u)
			u.Release()
			res.GUID = want[normGUID(r.guid)]
			if res.RebootRequired {
				reboot.Store(true)
			}
			report(res)
		}
		// GUIDs fora da lista de pendentes: podem ter sido instalados por fora (sucesso) ou
		// sumido do catalogo (falha).
		for _, g := range missing {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			installedNow, err := isInstalled(session, g)
			switch {
			case err != nil:
				report(InstallResult{GUID: g, Detail: err.Error()})
			case installedNow:
				report(InstallResult{GUID: g, Success: true, Detail: "ja instalada"})
			default:
				report(InstallResult{GUID: g, Detail: "atualizacao nao encontrada no Windows Update"})
			}
		}
		if rebootPending() {
			reboot.Store(true)
		}
		return nil
	})
	return reboot.Load(), err
}

func newSession() (*ole.IDispatch, error) {
	session, err := createDispatch("Microsoft.Update.Session")
	if err != nil {
		return nil, err
	}
	putValue(session, "ClientApplicationID", clientAppID)
	return session, nil
}

// search executa uma busca e converte o resultado.
func search(session *ole.IDispatch, criteria string) ([]Update, error) {
	searcher, err := callDisp(session, "CreateUpdateSearcher")
	if err != nil {
		return nil, err
	}
	defer searcher.Release()
	result, err := callDisp(searcher, "Search", criteria)
	if err != nil {
		return nil, comErr("busca no Windows Update ("+criteria+")", err)
	}
	defer result.Release()
	if code, _ := getInt(result, "ResultCode"); code != orcSucceeded && code != orcSucceededWithErrors {
		return nil, fmt.Errorf("busca no Windows Update (%s) terminou com codigo %d", criteria, code)
	}
	coll, err := getDisp(result, "Updates")
	if err != nil {
		return nil, err
	}
	defer coll.Release()
	var out []Update
	err = forEachItem(coll, func(_ int, u *ole.IDispatch) error {
		if item, ok := readUpdate(u); ok {
			out = append(out, item)
		}
		return nil
	})
	return out, err
}

// readUpdate le as propriedades de IUpdate usadas no contrato.
func readUpdate(u *ole.IDispatch) (Update, bool) {
	id, err := getDisp(u, "Identity")
	if err != nil {
		return Update{}, false
	}
	guid := getString(id, "UpdateID")
	rev, _ := getInt(id, "RevisionNumber")
	id.Release()
	if guid == "" {
		return Update{}, false
	}
	item := Update{
		GUID:           guid,
		KBArticleIDs:   stringList(u, "KBArticleIDs"),
		Title:          getString(u, "Title"),
		Description:    getString(u, "Description"),
		Severity:       getString(u, "MsrcSeverity"),
		MoreInfoURLs:   stringList(u, "MoreInfoUrls"),
		SupportURL:     getString(u, "SupportUrl"),
		RevisionNumber: rev,
		Installed:      getBool(u, "IsInstalled"),
		Downloaded:     getBool(u, "IsDownloaded"),
		Supersedes:     stringList(u, "SupersededUpdateIDs"),
		Categories:     []string{},
	}
	if cats, err := getDisp(u, "Categories"); err == nil {
		_ = forEachItem(cats, func(_ int, c *ole.IDispatch) error {
			if name := getString(c, "Name"); name != "" {
				item.Categories = append(item.Categories, name)
			}
			return nil
		})
		cats.Release()
	}
	return item, true
}

// installOne aceita a EULA, baixa (se preciso) e instala uma atualizacao.
func installOne(ctx context.Context, session, u *ole.IDispatch) InstallResult {
	coll, err := createDispatch("Microsoft.Update.UpdateColl")
	if err != nil {
		return InstallResult{Detail: err.Error()}
	}
	defer coll.Release()
	if err := callVoid(coll, "Add", u); err != nil {
		return InstallResult{Detail: err.Error()}
	}
	if !getBool(u, "EulaAccepted") {
		if err := callVoid(u, "AcceptEula"); err != nil {
			return InstallResult{Detail: err.Error()}
		}
	}

	if !getBool(u, "IsDownloaded") {
		if err := download(session, coll); err != nil {
			return InstallResult{Detail: err.Error()}
		}
	}

	installer, err := callDisp(session, "CreateUpdateInstaller")
	if err != nil {
		return InstallResult{Detail: err.Error()}
	}
	defer installer.Release()
	waitIdle(ctx, installer)
	putValue(installer, "AllowSourcePrompts", false)
	putValue(installer, "ForceQuiet", true) // IUpdateInstaller2; ignorado se nao existir
	if err := putObject(installer, "Updates", coll); err != nil {
		return InstallResult{Detail: err.Error()}
	}
	result, err := callDisp(installer, "Install")
	if err != nil {
		return InstallResult{Detail: comErr("instalacao", err).Error()}
	}
	defer result.Release()
	reboot := getBool(result, "RebootRequired")
	code, hr := updateResult(result)
	if code != orcSucceeded && code != orcSucceededWithErrors {
		return InstallResult{RebootRequired: reboot, Detail: fmt.Sprintf("instalacao terminou com codigo %d (HRESULT 0x%08X)", code, hr)}
	}
	return InstallResult{Success: true, RebootRequired: reboot}
}

func download(session, coll *ole.IDispatch) error {
	downloader, err := callDisp(session, "CreateUpdateDownloader")
	if err != nil {
		return err
	}
	defer downloader.Release()
	if err := putObject(downloader, "Updates", coll); err != nil {
		return err
	}
	result, err := callDisp(downloader, "Download")
	if err != nil {
		return comErr("download", err)
	}
	defer result.Release()
	code, hr := updateResult(result)
	if code != orcSucceeded && code != orcSucceededWithErrors {
		return fmt.Errorf("download terminou com codigo %d (HRESULT 0x%08X)", code, hr)
	}
	return nil
}

// updateResult le ResultCode e HResult do primeiro item (as colecoes aqui tem um so),
// caindo para o ResultCode geral se GetUpdateResult falhar.
func updateResult(result *ole.IDispatch) (code int, hr uint32) {
	if ur, err := callDisp(result, "GetUpdateResult", 0); err == nil {
		code, _ = getInt(ur, "ResultCode")
		h, _ := getInt(ur, "HResult")
		ur.Release()
		return code, uint32(int32(h))
	}
	code, _ = getInt(result, "ResultCode")
	h, _ := getInt(result, "HResult")
	return code, uint32(int32(h))
}

// waitIdle espera ate 30 minutos se outra instalacao (por exemplo a automatica) estiver em curso.
func waitIdle(ctx context.Context, installer *ole.IDispatch) {
	deadline := time.Now().Add(30 * time.Minute)
	for getBool(installer, "IsBusy") && time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
		}
	}
}

// isInstalled procura um GUID especifico (ja validado por normGUID) e diz se esta instalado.
func isInstalled(session *ole.IDispatch, guid string) (bool, error) {
	g := normGUID(guid)
	if g == "" {
		return false, errors.New("GUID invalido")
	}
	list, err := search(session, "UpdateID='"+g+"'")
	if err != nil {
		return false, err
	}
	for _, u := range list {
		if normGUID(u.GUID) == g && u.Installed {
			return true, nil
		}
	}
	return false, nil
}

// rebootPending consulta ISystemInformation.RebootRequired.
func rebootPending() bool {
	info, err := createDispatch("Microsoft.Update.SystemInfo")
	if err != nil {
		return false
	}
	defer info.Release()
	return getBool(info, "RebootRequired")
}
