import { defaultLabel, KEYBOARD_ROWS, MAP_CODES, systemLabel } from '../lib/keyboardMap';

interface Props {
  /** Tecla física -> o que o sistema escreve (mapa do navegador ou teclas já pressionadas). */
  layoutKeys: ReadonlyMap<string, string>;
  pressed: ReadonlySet<string>;
  down: ReadonlySet<string>;
}

export function KeyboardMap({ layoutKeys, pressed, down }: Props) {
  const tested = [...pressed].filter((c) => MAP_CODES.has(c)).length;
  return (
    <div className="kb-map" role="img" aria-label={`Desenho do teclado: ${String(tested)} de ${String(MAP_CODES.size)} teclas testadas`}>
      {KEYBOARD_ROWS.map((row, i) => (
        <div className="kb-row" key={i}>
          {row.map((k) => {
            const style = { flexGrow: k.w ?? 1 };
            if (k.gap) return <span key={k.code} className="kb-gap" style={style} />;
            const fromSystem = k.label ? '' : systemLabel(layoutKeys.get(k.code));
            const label = k.label ?? (fromSystem || defaultLabel(k.code));
            const cls = [
              'kb-key',
              pressed.has(k.code) ? 'kb-key-tested' : '',
              down.has(k.code) ? 'kb-key-down' : '',
              !k.label && !fromSystem ? 'kb-key-guess' : '',
            ].filter(Boolean).join(' ');
            return (
              <span key={k.code} className={cls} style={style} data-code={k.code} aria-hidden="true">
                {label}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
