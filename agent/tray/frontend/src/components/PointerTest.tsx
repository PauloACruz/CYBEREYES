import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { describeDevice } from '../lib/diagnostics';
import type { DeviceInfo } from '../lib/types';
import { DeviceList } from './DeviceList';

type Target = 'mouse' | 'touchpad';
type Check = 'left' | 'right' | 'middle' | 'double' | 'drag' | 'move' | 'wheelV' | 'wheelH' | 'pinch' | 'back' | 'forward';

interface Item {
  id: Check;
  label: string;
  /** Não conta como falha quando o aparelho não tem o recurso. */
  optional?: boolean;
}

const CHECKLIST: Record<Target, Item[]> = {
  mouse: [
    { id: 'left', label: 'Clique esquerdo' },
    { id: 'right', label: 'Clique direito' },
    { id: 'middle', label: 'Clique da roda (botão do meio)' },
    { id: 'double', label: 'Duplo clique' },
    { id: 'drag', label: 'Arrastar com o botão pressionado' },
    { id: 'move', label: 'Mover o ponteiro pelos quatro cantos da área' },
    { id: 'wheelV', label: 'Rolar a roda para cima e para baixo' },
    { id: 'back', label: 'Botão lateral Voltar', optional: true },
    { id: 'forward', label: 'Botão lateral Avançar', optional: true },
  ],
  touchpad: [
    { id: 'left', label: 'Toque ou clique com um dedo' },
    { id: 'right', label: 'Clique direito (dois dedos ou canto direito)' },
    { id: 'double', label: 'Duplo toque' },
    { id: 'drag', label: 'Arrastar' },
    { id: 'move', label: 'Mover o ponteiro pelos quatro cantos da área' },
    { id: 'wheelV', label: 'Rolar com dois dedos para cima e para baixo' },
    { id: 'wheelH', label: 'Rolar com dois dedos para os lados' },
    { id: 'pinch', label: 'Pinça com dois dedos (zoom)', optional: true },
  ],
};

const TARGET_LABEL: Record<Target, string> = { mouse: 'Mouse', touchpad: 'Touchpad' };
const BUTTON_CHECK: Partial<Record<number, Check>> = { 0: 'left', 1: 'middle', 2: 'right', 3: 'back', 4: 'forward' };
const DRAG_PX = 40;

interface Props {
  active: boolean;
  pointers: DeviceInfo[];
  supported: boolean;
  onResult: (lines: string[] | null) => void;
}

type Done = Record<Target, ReadonlySet<Check>>;

export function PointerTest({ active, pointers, supported, onResult }: Props) {
  const [target, setTarget] = useState<Target>('mouse');
  const [done, setDone] = useState<Done>({ mouse: new Set(), touchpad: new Set() });
  const [corners, setCorners] = useState<ReadonlySet<number>>(() => new Set());
  const [last, setLast] = useState('');
  const [touch, setTouch] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const targetRef = useRef(target);
  useEffect(() => { targetRef.current = target; }, [target]);

  const mark = useCallback((check: Check, text: string) => {
    const t = targetRef.current;
    setDone((d) => (d[t].has(check) ? d : { ...d, [t]: new Set(d[t]).add(check) }));
    setLast(text);
  }, []);

  // A roda e os gestos do touchpad chegam como wheel; o listener precisa ser ativo (não passivo) para
  // impedir a rolagem e o zoom da janela. A pinça chega com ctrlKey no Chromium.
  useEffect(() => {
    const el = area.current;
    if (!el || !active) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) mark('pinch', 'Pinça (zoom)');
      else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) mark('wheelH', e.deltaX > 0 ? 'Rolagem para a direita' : 'Rolagem para a esquerda');
      else if (e.deltaY !== 0) mark('wheelV', e.deltaY > 0 ? 'Rolagem para baixo' : 'Rolagem para cima');
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { el.removeEventListener('wheel', onWheel); };
  }, [active, mark]);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'touch') setTouch(true);
    const check = BUTTON_CHECK[e.button];
    // O botão do meio liga a rolagem automática e os laterais navegam: nenhum dos dois pode agir aqui.
    if (e.button !== 0) e.preventDefault();
    if (check) mark(check, CHECKLIST.mouse.find((i) => i.id === check)?.label ?? '');
    if (e.button === 0) drag.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const col = e.clientX - rect.left < rect.width / 2 ? 0 : 1;
      const row = e.clientY - rect.top < rect.height / 2 ? 0 : 1;
      const corner = row * 2 + col;
      if (!corners.has(corner)) {
        const next = new Set(corners).add(corner);
        setCorners(next);
        if (next.size === 4) mark('move', 'Ponteiro passou pelos quatro cantos');
      }
    }
    const start = drag.current;
    if (start && e.buttons & 1 && Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_PX) {
      drag.current = null;
      mark('drag', 'Arrastar');
    }
  }

  const items = CHECKLIST[target];
  const lines = useMemo(() => {
    const out: string[] = [];
    for (const t of ['mouse', 'touchpad'] as const) {
      const got = done[t];
      if (got.size === 0) continue;
      const required = CHECKLIST[t].filter((i) => !i.optional);
      const ok = required.filter((i) => got.has(i.id));
      const missing = required.filter((i) => !got.has(i.id)).map((i) => i.label.toLowerCase());
      const extras = CHECKLIST[t].filter((i) => i.optional && got.has(i.id)).map((i) => i.label.toLowerCase());
      let line = `${TARGET_LABEL[t]}: ${String(ok.length)} de ${String(required.length)} itens funcionaram`;
      if (missing.length > 0) line += `; não testado ou sem resposta: ${missing.join(', ')}`;
      if (extras.length > 0) line += `; também: ${extras.join(', ')}`;
      out.push(line);
    }
    if (touch) out.push('Tela sensível ao toque: respondeu');
    if (out.length === 0) return null;
    if (supported) out.push(`Dispositivos: ${pointers.length > 0 ? pointers.map(describeDevice).join('; ') : 'nenhum encontrado'}`);
    return out;
  }, [done, touch, supported, pointers]);

  useEffect(() => { onResult(lines); }, [lines, onResult]);

  function reset() {
    setDone((d) => ({ ...d, [target]: new Set() }));
    setCorners(new Set());
    setLast('');
  }

  const got = done[target];
  return (
    <section className="diag-section" hidden={!active} aria-label="Teste de mouse e touchpad">
      <div className="help-chips" role="group" aria-label="Aparelho testado">
        {(['mouse', 'touchpad'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`chip${target === t ? ' chip-active' : ''}`}
            aria-pressed={target === t}
            onClick={() => {
              setTarget(t);
              setCorners(new Set());
              setLast('');
            }}
          >
            {TARGET_LABEL[t]}
          </button>
        ))}
      </div>
      <p className="small muted">
        Teste um aparelho de cada vez, dentro da área abaixo. {target === 'touchpad' ? 'Se houver mouse ligado, não mexa nele.' : ''}
      </p>
      <div
        ref={area}
        className="pt-area"
        data-testid="pt-area"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => { drag.current = null; }}
        onDoubleClick={() => { mark('double', 'Duplo clique'); }}
        onContextMenu={(e) => { e.preventDefault(); }}
        onMouseUp={(e) => { if (e.button > 2) e.preventDefault(); }}
        onAuxClick={(e) => { e.preventDefault(); }}
      >
        <span className="pt-last" aria-live="polite">{last || 'Use o aparelho aqui dentro'}</span>
      </div>
      <ul className="pt-checklist">
        {items.map((i) => (
          <li key={i.id} className={got.has(i.id) ? 'pt-ok' : ''}>
            <span className="pt-mark" aria-hidden="true">{got.has(i.id) ? '✓' : '○'}</span>
            {i.label}
            {i.optional && <span className="muted small"> (se houver)</span>}
            <span className="sr-only">{got.has(i.id) ? ': funcionou' : ': ainda não'}</span>
          </li>
        ))}
      </ul>
      <DeviceList
        title="Mouses e touchpads conectados"
        devices={pointers}
        empty="Nenhum mouse ou touchpad encontrado."
        supported={supported}
      />
      <div className="ss-actions">
        <button type="button" className="btn btn-secondary" onClick={reset}>Recomeçar {TARGET_LABEL[target].toLowerCase()}</button>
      </div>
    </section>
  );
}
