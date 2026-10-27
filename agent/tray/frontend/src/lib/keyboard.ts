/**
 * Teste de teclado: o usuário digita o texto de referência olhando para as teclas. Cada caractere
 * esperado diz qual tecla ele procurou; a tecla física (KeyboardEvent.code) diz onde ela está. Com
 * isso dá para saber o modelo do teclado (ABNT2 ou americano) sem depender do layout configurado, e
 * comparar com o que o sistema escreveu.
 */

export type PhysicalModel = 'abnt2' | 'us';
export type LayoutFamily = 'abnt2' | 'us' | 'us-intl' | 'other';

/** Texto que o usuário digita. Os símbolos ficam em teclas diferentes no ABNT2 e no americano. */
export const REFERENCE_TEXT = 'Maçã; pé: 1/2? [ok] {sim} \\ | \'a\' "b"';

/**
 * O que está impresso nas teclas que mudam de lugar entre os dois modelos, sem e com Shift. As
 * demais (letras, números, vírgula, ponto, menos e igual) são iguais e não ajudam a distinguir.
 */
const KEYCAPS: Record<PhysicalModel, Record<string, readonly [string, string]>> = {
  abnt2: {
    Backquote: ["'", '"'],
    BracketLeft: ['´', '`'],
    BracketRight: ['[', '{'],
    Backslash: [']', '}'],
    Semicolon: ['ç', 'Ç'],
    Quote: ['~', '^'],
    IntlBackslash: ['\\', '|'],
    Slash: [';', ':'],
    IntlRo: ['/', '?'],
  },
  us: {
    Backquote: ['`', '~'],
    Quote: ["'", '"'],
    BracketLeft: ['[', '{'],
    BracketRight: [']', '}'],
    Backslash: ['\\', '|'],
    Semicolon: [';', ':'],
    Slash: ['/', '?'],
  },
};

const BRAZILIAN_ONLY = /^[çÇáàâãéêíóôõúü]$/;

/** Letra acentuada -> tecla de acento (morta) que o usuário procura para escrevê-la. */
const ACCENT: Record<string, string> = { á: '´', é: '´', í: '´', ó: '´', ú: '´', à: '`', â: '^', ê: '^', ô: '^', ã: '~', õ: '~' };

function baseLetter(c: string): string {
  return c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** O caractere esperado (ou o acento dele) está impresso nessa tecla física, no modelo dado. */
function printedOn(model: PhysicalModel, code: string, expected: string): boolean {
  const caps = KEYCAPS[model][code];
  if (!caps) return false;
  const accent = ACCENT[expected.toLowerCase()];
  return caps.includes(expected) || (accent !== undefined && caps.includes(accent));
}

export const MODEL_LABEL: Record<PhysicalModel, string> = {
  abnt2: 'ABNT2 (brasileiro, com a tecla Ç)',
  us: 'Americano (sem a tecla Ç)',
};

const SUGGESTED_LAYOUT: Record<PhysicalModel, string> = {
  abnt2: 'Português (Brasil ABNT2)',
  us: 'Inglês (EUA) — Internacional, se precisar de acentos',
};

const FAMILY_LABEL: Record<LayoutFamily, string> = {
  abnt2: 'ABNT2',
  us: 'americano',
  'us-intl': 'americano internacional',
  other: 'outro',
};

/** Família do layout pelo identificador do sistema: KLID do Windows ou layout do XKB no Linux. */
export function layoutFamilyFromId(id: string | undefined): LayoutFamily | null {
  const v = (id ?? '').trim().toLowerCase();
  if (!v) return null;
  if (v === '00000416' || v === '00010416' || v === 'br' || v.startsWith('br(')) return 'abnt2';
  if (v === '00000409' || v === 'us') return 'us';
  if (v === '00020409' || v === 'us(intl)' || v === 'us(alt-intl)') return 'us-intl';
  return 'other';
}

/**
 * Família do layout pelo que o sistema escreve em cada tecla física (mapa do navegador ou teclas já
 * pressionadas). Devolve null enquanto nenhuma tecla que distingue foi vista.
 */
export function layoutFamilyFromKeys(keys: ReadonlyMap<string, string>): LayoutFamily | null {
  const semi = keys.get('Semicolon');
  if (semi === 'ç' || semi === 'Ç' || keys.get('IntlRo') === '/') return 'abnt2';
  if (semi === ';' || semi === ':') return keys.get('Quote') === 'Dead' ? 'us-intl' : 'us';
  return null;
}

function american(f: LayoutFamily | null): boolean {
  return f === 'us' || f === 'us-intl';
}

export type AlignOp =
  | { type: 'match'; expected: string; got: string }
  | { type: 'sub'; expected: string; got: string }
  | { type: 'del'; expected: string }
  | { type: 'ins'; got: string };

/**
 * Alinha o texto digitado com o de referência pela distância de edição: uma tecla morta que engole o
 * caractere seguinte, ou uma tecla que não escreve nada, não desalinha o resto da frase. subCost dá o
 * custo de trocar um caractere por outro (padrão 1): a análise barateia a troca quando a tecla
 * apertada tem o caractere esperado impresso, o que prende "ç" ao ";" que saiu no lugar dele.
 */
export function align(expected: string, typed: string, subCost: (expected: string, got: string) => number = () => 1): AlignOp[] {
  const a = Array.from(expected);
  const b = Array.from(typed);
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  // Matriz (n+1) x (m+1) da distância de edição, numa lista só.
  const d = new Array<number>((n + 1) * w).fill(0);
  const at = (i: number, j: number) => d[i * w + j] ?? 0;
  const ch = (s: string[], k: number) => s[k] ?? '';
  const cost = (x: string, y: string) => (x === y ? 0 : subCost(x, y));
  for (let i = 0; i <= n; i++) d[i * w] = i;
  for (let j = 0; j <= m; j++) d[j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i * w + j] = Math.min(at(i - 1, j - 1) + cost(ch(a, i - 1), ch(b, j - 1)), at(i - 1, j) + 1, at(i, j - 1) + 1);
    }
  }
  const ops: AlignOp[] = [];
  let i = n;
  let j = m;
  // No empate, o caractere a mais fica no fim do trecho, que é como o usuário lê o erro.
  while (i > 0 || j > 0) {
    const x = ch(a, i - 1);
    const y = ch(b, j - 1);
    if (i > 0 && j > 0 && x === y && at(i, j) === at(i - 1, j - 1)) {
      ops.push({ type: 'match', expected: x, got: y });
      i--;
      j--;
    } else if (j > 0 && at(i, j) === at(i, j - 1) + 1) {
      ops.push({ type: 'ins', got: y });
      j--;
    } else if (i > 0 && j > 0 && at(i, j) === at(i - 1, j - 1) + cost(x, y)) {
      ops.push({ type: 'sub', expected: x, got: y });
      i--;
      j--;
    } else {
      ops.push({ type: 'del', expected: x });
      i--;
    }
  }
  return ops.reverse();
}

export interface KeyDifference {
  expected?: string | undefined;
  got?: string | undefined;
  /** Tecla física que escreveu o caractere, quando conhecida. */
  code?: string | undefined;
}

export type KeyboardVerdict = 'pending' | 'ok' | 'mismatch' | 'unknown';

export interface KeyboardAnalysis {
  /** Alinhamento do que foi digitado até agora (sem o resto do texto que falta digitar). */
  ops: AlignOp[];
  differences: KeyDifference[];
  physical: PhysicalModel | null;
  configured: LayoutFamily | null;
  verdict: KeyboardVerdict;
  message: string;
}

export interface KeyboardInput {
  typed: string;
  /** Caractere escrito -> teclas físicas que o escreveram (no layout errado, duas teclas podem escrever o mesmo). */
  charCode: ReadonlyMap<string, readonly string[]>;
  /** Teclas físicas pressionadas. */
  codesSeen: ReadonlySet<string>;
  /** Identificador do layout do sistema (KLID ou XKB). */
  layoutId?: string | undefined;
  /** Tecla física -> caractere, pelo mapa do navegador ou pelo que já foi digitado. */
  layoutKeys: ReadonlyMap<string, string>;
}

export function analyzeKeyboard(input: KeyboardInput): KeyboardAnalysis {
  const codesOf = (c: string) => input.charCode.get(c) ?? [];
  const plausible = (e: string, g: string) => codesOf(g).some((c) => printedOn('abnt2', c, e) || printedOn('us', c, e));
  const all = align(REFERENCE_TEXT, input.typed, (e, g) => (plausible(e, g) ? 0.5 : 1));
  // O fim do texto que ainda não foi digitado não é diferença.
  let end = all.length;
  while (end > 0 && all[end - 1]?.type === 'del') end--;
  const ops = all.slice(0, end);
  const differences: KeyDifference[] = [];
  const votes: Record<PhysicalModel, number> = { abnt2: 0, us: 0 };
  for (const op of ops) {
    if (op.type === 'del') {
      differences.push({ expected: op.expected });
      continue;
    }
    const codes = codesOf(op.got);
    const code = codes.length > 0 ? codes.join('/') : undefined;
    if (op.type === 'ins') {
      // A tecla de acento escreveu o sinal e a letra veio separada: "ã" virou "'a", uma diferença só.
      const prev = differences[differences.length - 1];
      if (prev?.expected && prev.got && ACCENT[prev.expected.toLowerCase()] && baseLetter(prev.expected) === op.got.toLowerCase()) {
        prev.got += op.got;
        continue;
      }
      differences.push({ got: op.got, code });
      continue;
    }
    if (op.type === 'sub') differences.push({ expected: op.expected, got: op.got, code });
    for (const model of ['abnt2', 'us'] as const) {
      if (codes.some((c) => printedOn(model, c, op.expected))) votes[model]++;
    }
  }
  // A tecla "/?" ao lado do Shift direito só existe no ABNT2.
  if (input.codesSeen.has('IntlRo')) votes.abnt2 += 2;

  const physical = votes.abnt2 > votes.us ? 'abnt2' : votes.us > votes.abnt2 ? 'us' : null;
  // O teclado americano não tem Ç nem acentos impressos: essas diferenças não são defeito.
  if (physical === 'us') {
    for (let i = differences.length - 1; i >= 0; i--) {
      if (BRAZILIAN_ONLY.test(differences[i]?.expected ?? '')) differences.splice(i, 1);
    }
  }
  const configured = layoutFamilyFromId(input.layoutId) ?? layoutFamilyFromKeys(input.layoutKeys);
  // Chegou ao fim quando o alinhamento alcançou o fim do texto de referência: com o layout errado,
  // teclas mortas engolem caracteres e o texto digitado fica mais curto que o esperado.
  const reached = ops.filter((o) => o.type !== 'ins').length;
  const done = reached >= Array.from(REFERENCE_TEXT).length - 2;

  let verdict: KeyboardVerdict;
  let message: string;
  if (!done) {
    verdict = 'pending';
    message = 'Digite o texto até o fim para conferir o teclado.';
  } else if (!physical) {
    verdict = 'unknown';
    message = 'Não deu para identificar o modelo do teclado. Digite o texto olhando para as teclas, sem usar atalhos.';
  } else if (configured === null || configured === 'other') {
    verdict = 'unknown';
    message = `O teclado parece ser ${MODEL_LABEL[physical]}, mas o layout configurado não foi reconhecido. O indicado é ${SUGGESTED_LAYOUT[physical]}.`;
  } else if ((physical === 'abnt2' && configured === 'abnt2') || (physical === 'us' && american(configured))) {
    verdict = 'ok';
    message =
      differences.length === 0
        ? 'As teclas batem com o layout configurado.'
        : `O layout configurado bate com o teclado. ${diffCount(differences.length)}: confira se foi erro de digitação ou tecla com defeito.`;
  } else {
    verdict = 'mismatch';
    message = `O teclado é ${MODEL_LABEL[physical]}, mas o sistema está configurado como ${FAMILY_LABEL[configured]}. Ajuste o layout para ${SUGGESTED_LAYOUT[physical]}.`;
  }
  return { ops, differences, physical, configured, verdict, message };
}

function diffCount(n: number): string {
  return n === 1 ? '1 caractere saiu diferente' : `${String(n)} caracteres saíram diferentes`;
}

function quote(c: string): string {
  return c === ' ' ? 'espaço' : `“${c}”`;
}

/** Diferença em uma linha para a tela e para o resultado enviado ao técnico. */
export function describeDifference(d: KeyDifference): string {
  const where = d.code ? ` (tecla ${d.code})` : '';
  if (d.expected !== undefined && d.got !== undefined) return `A tecla ${quote(d.expected)} escreveu ${quote(d.got)}${where}`;
  if (d.expected !== undefined) return `A tecla ${quote(d.expected)} não escreveu nada`;
  return `${quote(d.got ?? '')} a mais${where}`;
}
