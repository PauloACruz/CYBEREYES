/** Desenho do teclado no teste: geometria do ABNT2, que tem todas as teclas do americano e mais duas. */

export interface MapKey {
  code: string;
  /** Rótulo fixo (teclas de função e modificadores). Sem ele, a tecla mostra o que o sistema escreve. */
  label?: string;
  /** Largura em unidades de tecla (padrão 1). */
  w?: number;
  /** Espaço vazio, só para alinhar a fileira. */
  gap?: boolean;
}

const letters = (s: string): MapKey[] => Array.from(s).map((c) => ({ code: `Key${c}` }));
const digits: MapKey[] = Array.from('1234567890').map((c) => ({ code: `Digit${c}` }));
const fkeys: MapKey[] = Array.from({ length: 12 }, (_, i) => ({ code: `F${String(i + 1)}`, label: `F${String(i + 1)}` }));

export const KEYBOARD_ROWS: MapKey[][] = [
  [{ code: 'Escape', label: 'Esc' }, ...fkeys],
  [{ code: 'Backquote' }, ...digits, { code: 'Minus' }, { code: 'Equal' }, { code: 'Backspace', label: '⌫', w: 2 }],
  [{ code: 'Tab', label: 'Tab', w: 1.5 }, ...letters('QWERTYUIOP'), { code: 'BracketLeft' }, { code: 'BracketRight' }, { code: 'Enter', label: 'Enter', w: 1.5 }],
  [{ code: 'CapsLock', label: 'Caps', w: 1.75 }, ...letters('ASDFGHJKL'), { code: 'Semicolon' }, { code: 'Quote' }, { code: 'Backslash' }, { code: 'gap-3', gap: true, w: 1.25 }],
  [
    { code: 'ShiftLeft', label: '⇧', w: 1.25 },
    { code: 'IntlBackslash' },
    ...letters('ZXCVBNM'),
    { code: 'Comma' },
    { code: 'Period' },
    { code: 'Slash' },
    { code: 'IntlRo' },
    { code: 'ShiftRight', label: 'Shift', w: 1.75 },
  ],
  [
    { code: 'ControlLeft', label: 'Ctrl', w: 1.25 },
    { code: 'MetaLeft', label: 'Win', w: 1.25 },
    { code: 'AltLeft', label: 'Alt', w: 1.25 },
    { code: 'Space', label: 'Espaço', w: 7.5 },
    { code: 'AltRight', label: 'AltGr', w: 1.25 },
    { code: 'ContextMenu', label: 'Menu', w: 1.25 },
    { code: 'ControlRight', label: 'Ctrl', w: 1.25 },
  ],
  [
    { code: 'Insert', label: 'Ins' },
    { code: 'Delete', label: 'Del' },
    { code: 'Home', label: 'Home' },
    { code: 'End', label: 'End' },
    { code: 'PageUp', label: 'PgUp' },
    { code: 'PageDown', label: 'PgDn' },
    { code: 'gap-6', gap: true, w: 0.5 },
    { code: 'ArrowLeft', label: '←' },
    { code: 'ArrowUp', label: '↑' },
    { code: 'ArrowDown', label: '↓' },
    { code: 'ArrowRight', label: '→' },
  ],
];

/** Teclas desenhadas (sem os espaços), para a contagem de testadas. */
export const MAP_CODES: ReadonlySet<string> = new Set(KEYBOARD_ROWS.flat().filter((k) => !k.gap).map((k) => k.code));

/** O que vem impresso no ABNT2: aparece apagado até o sistema dizer o que a tecla escreve. */
const ABNT2_LABELS: Record<string, string> = {
  Backquote: "'",
  Minus: '-',
  Equal: '=',
  BracketLeft: '´',
  BracketRight: '[',
  Backslash: ']',
  Semicolon: 'Ç',
  Quote: '~',
  IntlBackslash: '\\',
  Comma: ',',
  Period: '.',
  Slash: ';',
  IntlRo: '/',
};

export function defaultLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return ABNT2_LABELS[code] ?? '';
}

/** Rótulo do que o sistema escreve: letra maiúscula, como no teclado; teclas mortas ficam sem. */
export function systemLabel(key: string | undefined): string {
  if (!key || key === 'Dead' || key === 'Unidentified' || Array.from(key).length !== 1) return '';
  return key.toLocaleUpperCase('pt-BR');
}

/** Nome da tecla fora do desenho (teclado numérico, Print Screen, mídia) para a lista de outras teclas. */
export function otherKeyLabel(code: string): string {
  if (code.startsWith('Numpad')) {
    const rest = code.slice(6);
    const symbols: Record<string, string> = { Add: '+', Subtract: '−', Multiply: '×', Divide: '÷', Decimal: ',', Comma: ',' };
    return `Num ${symbols[rest] ?? rest}`;
  }
  const names: Record<string, string> = {
    PrintScreen: 'Print Screen',
    ScrollLock: 'Scroll Lock',
    Pause: 'Pause',
    NumLock: 'Num Lock',
    MetaRight: 'Win direito',
    AudioVolumeUp: 'Volume +',
    AudioVolumeDown: 'Volume −',
    AudioVolumeMute: 'Mudo',
    MediaPlayPause: 'Play/Pause',
    MediaTrackNext: 'Próxima faixa',
    MediaTrackPrevious: 'Faixa anterior',
  };
  return names[code] ?? code;
}
