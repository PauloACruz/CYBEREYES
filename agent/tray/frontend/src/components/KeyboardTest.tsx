import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '../lib/backend';
import { describeDevice, type KeyboardLiveState } from '../lib/diagnostics';
import { analyzeKeyboard, describeDifference, MODEL_LABEL, REFERENCE_TEXT } from '../lib/keyboard';
import { MAP_CODES, otherKeyLabel } from '../lib/keyboardMap';
import type { Backend, DeviceInfo, KeyboardLayoutInfo } from '../lib/types';
import { DeviceList } from './DeviceList';
import { KeyboardMap } from './KeyboardMap';

interface Props {
  backend: Backend;
  /** Seção visível: só então o teste escuta o teclado. */
  active: boolean;
  keyboards: DeviceInfo[];
  supported: boolean;
  onResult: (lines: string[] | null) => void;
  /** Estado completo para o técnico acompanhar ao vivo. */
  onState: (state: KeyboardLiveState) => void;
}

// Keyboard Map API (Chromium/WebView2): diz o que cada tecla física escreve no layout ativo antes de
// o usuário pressioná-la. O WebKitGTK do Linux não tem; o desenho completa com as teclas pressionadas.
interface LayoutMapLike {
  forEach(cb: (value: string, key: string) => void): void;
}
type NavigatorWithKeyboard = Navigator & { keyboard?: { getLayoutMap?: () => Promise<LayoutMapLike> } };

async function readLayoutMap(): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const kb = (navigator as NavigatorWithKeyboard).keyboard;
  if (!kb?.getLayoutMap) return m;
  try {
    (await kb.getLayoutMap()).forEach((value, code) => { m.set(code, value); });
  } catch {
    // Sem permissão ou sem suporte: fica só o que for digitado.
  }
  return m;
}

const EDIT_SHORTCUTS = new Set(['a', 'c', 'x', 'z', 'y']);
const SCROLL_KEYS = new Set([' ', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);

/**
 * Teclas que não podem fazer a ação padrão durante o teste: F1 a F12, atalhos com Ctrl (menos os de
 * edição; AltGr no Windows chega como Ctrl+Alt e precisa passar), Tab dentro do campo e as que rolam
 * a tela quando nada está em foco.
 */
function shouldBlock(e: KeyboardEvent, inField: boolean): boolean {
  if (/^F\d{1,2}$/.test(e.code)) return true;
  if (e.code === 'Tab') return inField;
  const altGr = typeof e.getModifierState === 'function' && e.getModifierState('AltGraph');
  if ((e.ctrlKey || e.metaKey) && !altGr && Array.from(e.key).length === 1 && !EDIT_SHORTCUTS.has(e.key.toLowerCase())) return true;
  return !inField && e.target === document.body && SCROLL_KEYS.has(e.key);
}

function addTo(set: Set<string>, v: string): Set<string> {
  return set.has(v) ? set : new Set(set).add(v);
}

function putIn(map: Map<string, string>, k: string, v: string): Map<string, string> {
  return map.get(k) === v ? map : new Map(map).set(k, v);
}

const ADJUST_HINT = navigator.userAgent.includes('Windows')
  ? 'No Windows: Configurações › Hora e idioma › Idioma e região › Português (Brasil) › Opções do idioma › Teclados.'
  : 'No Linux: Configurações › Teclado › Fontes de entrada.';

export function KeyboardTest({ backend, active, keyboards, supported, onResult, onState }: Props) {
  const [layout, setLayout] = useState<KeyboardLayoutInfo | null>(null);
  const [mapKeys, setMapKeys] = useState<Map<string, string>>(() => new Map());
  const [observed, setObserved] = useState<Map<string, string>>(() => new Map());
  const [charCode, setCharCode] = useState<Map<string, string[]>>(() => new Map());
  const [pressed, setPressed] = useState<Set<string>>(() => new Set());
  const [down, setDown] = useState<Set<string>>(() => new Set());
  const [typed, setTyped] = useState('');
  const [pasted, setPasted] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // O layout pode mudar com Win+Espaço: é lido de novo ao abrir a seção e ao entrar no campo.
  const refreshLayout = useCallback(() => {
    backend.keyboardLayout().then(setLayout, (e: unknown) => { setLayout({ id: '', name: '', error: errorMessage(e) }); });
    void readLayoutMap().then(setMapKeys);
  }, [backend]);

  useEffect(() => {
    if (!active) return;
    refreshLayout();
    // O técnico pede pelo telefone para digitar: o campo já fica pronto.
    fieldRef.current?.focus();
  }, [active, refreshLayout]);

  useEffect(() => {
    if (!active) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.key === 'Process') return;
      const code = e.code;
      if (code) {
        setPressed((s) => addTo(s, code));
        setDown((s) => addTo(s, code));
        const altGr = typeof e.getModifierState === 'function' && e.getModifierState('AltGraph');
        const plain = !e.shiftKey && !altGr && !e.ctrlKey && !e.metaKey;
        if (Array.from(e.key).length === 1) {
          setCharCode((m) => (m.get(e.key)?.includes(code) ? m : new Map(m).set(e.key, [...(m.get(e.key) ?? []), code])));
          // Depois de uma tecla de acento, a letra chega já acentuada ("é" na tecla E): não é o que a
          // tecla escreve sozinha. Só nas letras: o "ç" da tecla Ç também se decompõe e precisa ficar.
          const composed = code.startsWith('Key') && e.key.normalize('NFD').length > 1;
          if (plain && !composed) setObserved((m) => putIn(m, code, e.key));
        } else if (e.key === 'Dead' && plain) {
          setObserved((m) => putIn(m, code, 'Dead'));
        }
      }
      if (shouldBlock(e, e.target === fieldRef.current)) e.preventDefault();
    };
    // Print Screen só chega no keyup.
    const onUp = (e: KeyboardEvent) => {
      const code = e.code;
      if (!code) return;
      setPressed((s) => addTo(s, code));
      setDown((s) => {
        if (!s.has(code)) return s;
        const n = new Set(s);
        n.delete(code);
        return n;
      });
    };
    const onBlur = () => { setDown(new Set()); };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [active]);

  const layoutKeys = useMemo(() => new Map([...mapKeys, ...observed]), [mapKeys, observed]);
  const analysis = useMemo(
    () => analyzeKeyboard({ typed, charCode, codesSeen: pressed, layoutId: layout?.id, layoutKeys }),
    [typed, charCode, pressed, layout, layoutKeys],
  );
  const tested = useMemo(() => [...pressed].filter((c) => MAP_CODES.has(c)).length, [pressed]);
  const others = useMemo(() => [...pressed].filter((c) => !MAP_CODES.has(c)).map(otherKeyLabel), [pressed]);

  const lines = useMemo(() => {
    if (!typed && pressed.size === 0) return null;
    const out: string[] = [];
    if (layout?.name) out.push(`Layout configurado: ${layout.name}${layout.id && layout.id !== layout.name ? ` (${layout.id})` : ''}`);
    else out.push(`Layout configurado: não lido${layout?.error ? ` (${layout.error})` : ''}`);
    if (layout?.installed?.length) out.push(`Também instalado: ${layout.installed.join(', ')}`);
    out.push(`Modelo provável do teclado: ${analysis.physical ? MODEL_LABEL[analysis.physical] : 'não identificado'}`);
    out.push(`Resultado: ${analysis.message}`);
    out.push(`Texto de referência: ${REFERENCE_TEXT}`);
    out.push(`Texto digitado: ${typed || '(nada)'}`);
    for (const d of analysis.differences.slice(0, 10)) out.push(describeDifference(d));
    if (analysis.differences.length > 10) out.push(`e mais ${String(analysis.differences.length - 10)} diferenças`);
    out.push(`Teclas testadas no desenho: ${String(tested)} de ${String(MAP_CODES.size)}`);
    if (others.length > 0) out.push(`Outras teclas pressionadas: ${others.join(', ')}`);
    if (supported) out.push(`Teclados conectados: ${keyboards.length > 0 ? keyboards.map(describeDevice).join('; ') : 'nenhum encontrado'}`);
    return out;
  }, [typed, pressed, layout, analysis, tested, others, supported, keyboards]);

  useEffect(() => { onResult(lines); }, [lines, onResult]);

  const live = useMemo<KeyboardLiveState>(() => ({
    layout,
    reference: REFERENCE_TEXT,
    typed,
    ops: analysis.ops.map((op) => {
      if (op.type === 'match') return { t: 'm', g: op.got };
      if (op.type === 'sub') return { t: 's', e: op.expected, g: op.got };
      if (op.type === 'ins') return { t: 'i', g: op.got };
      return { t: 'd', e: op.expected };
    }),
    verdict: analysis.verdict,
    message: analysis.message,
    model: analysis.physical ? MODEL_LABEL[analysis.physical] : null,
    differences: analysis.differences.slice(0, 20).map(describeDifference),
    pressed: [...pressed],
    down: [...down],
    layoutKeys: Object.fromEntries(layoutKeys),
    others,
    tested,
    total: MAP_CODES.size,
  }), [layout, typed, analysis, pressed, down, layoutKeys, others, tested]);

  useEffect(() => { onState(live); }, [live, onState]);

  function reset() {
    setTyped('');
    setPressed(new Set());
    setDown(new Set());
    setCharCode(new Map());
    setObserved(new Map());
    setPasted(false);
    refreshLayout();
    fieldRef.current?.focus();
  }

  return (
    <section className="diag-section" hidden={!active} aria-label="Teste de teclado">
      <div className="diag-facts">
        <p>
          <span className="muted">Layout configurado: </span>
          {layout === null ? (
            <span className="muted">lendo...</span>
          ) : layout.name ? (
            <strong>{layout.name}</strong>
          ) : (
            <span className="muted">não foi possível ler{layout.error ? ` (${layout.error})` : ''}</span>
          )}
        </p>
        {layout?.installed && layout.installed.length > 0 && (
          <p className="small muted">Também instalado: {layout.installed.join(', ')}</p>
        )}
      </div>
      <DeviceList title="Teclados conectados" devices={keyboards} empty="Nenhum teclado encontrado." supported={supported} />

      <label className="diag-label" htmlFor="kb-field">Digite o texto abaixo olhando para as teclas do teclado:</label>
      <p className="kb-reference">{REFERENCE_TEXT}</p>
      <textarea
        id="kb-field"
        ref={fieldRef}
        className="kb-field"
        rows={2}
        maxLength={200}
        value={typed}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        onFocus={refreshLayout}
        onChange={(e) => { setTyped(e.target.value); }}
        onPaste={(e) => {
          e.preventDefault();
          setPasted(true);
        }}
        onDrop={(e) => { e.preventDefault(); }}
      />
      {pasted && <p className="small notice">Colar não vale: digite o texto pelo teclado.</p>}

      {analysis.ops.length > 0 && (
        <div className="kb-typed-box">
          <h4 className="section-title">Texto digitado</h4>
          <p className="kb-typed" data-testid="kb-typed">
            {analysis.ops.map((op, i) => {
              if (op.type === 'match') return <span key={i}>{op.got}</span>;
              if (op.type === 'sub') return <mark key={i} className="kb-sub" title={`Esperado ${op.expected}`}>{op.got}</mark>;
              if (op.type === 'ins') return <mark key={i} className="kb-ins" title="Caractere a mais">{op.got}</mark>;
              return <mark key={i} className="kb-del" title={`Faltou ${op.expected}`}>{op.expected}</mark>;
            })}
          </p>
        </div>
      )}

      <div className={`kb-verdict kb-verdict-${analysis.verdict}`} role="status">
        {analysis.physical && <p className="kb-model">Teclado: {MODEL_LABEL[analysis.physical]}</p>}
        <p>{analysis.message}</p>
        {analysis.verdict === 'mismatch' && <p className="small">{ADJUST_HINT}</p>}
        {analysis.differences.length > 0 && analysis.verdict !== 'pending' && (
          <ul className="kb-diffs">
            {analysis.differences.slice(0, 8).map((d, i) => <li key={i}>{describeDifference(d)}</li>)}
          </ul>
        )}
      </div>

      <KeyboardMap layoutKeys={layoutKeys} pressed={pressed} down={down} />
      <p className="small muted">
        {tested} de {MAP_CODES.size} teclas testadas. Cada tecla do desenho mostra o que o sistema escreve com ela: compare
        com o que está impresso no seu teclado. Fn e algumas teclas especiais são tratadas pelo próprio teclado e não acendem.
      </p>
      {others.length > 0 && <p className="small">Outras teclas: {others.join(', ')}</p>}
      <div className="ss-actions">
        <button type="button" className="btn btn-secondary" onClick={reset}>Recomeçar</button>
      </div>
    </section>
  );
}
