import { describe, expect, it } from 'vitest';
import { align, analyzeKeyboard, describeDifference, layoutFamilyFromId, layoutFamilyFromKeys, REFERENCE_TEXT } from './keyboard';
import { diffUsb } from './diagnostics';
import type { DeviceInfo } from './types';

// Caractere -> teclas físicas, como o teste monta a partir dos keydown.
function codes(pairs: Record<string, string | string[]>): Map<string, string[]> {
  return new Map(Object.entries(pairs).map(([k, v]) => [k, Array.isArray(v) ? v : [v]]));
}

// O que o ABNT2 escreve nas teclas que mudam de lugar (o resto é igual nos dois).
const ABNT2_ON_ABNT2 = codes({
  'ç': 'Semicolon', ';': 'Slash', ':': 'Slash', '/': 'IntlRo', '?': 'IntlRo', '[': 'BracketRight', '{': 'BracketRight',
  ']': 'Backslash', '}': 'Backslash', '\\': 'IntlBackslash', '|': 'IntlBackslash', "'": 'Backquote', '"': 'Backquote',
});

describe('align', () => {
  it('não desalinha quando uma tecla não escreve nada', () => {
    const ops = align('1/2', '12');
    expect(ops.map((o) => o.type)).toEqual(['match', 'del', 'match']);
  });

  it('marca troca e caractere a mais', () => {
    expect(align('ab', 'xb').map((o) => o.type)).toEqual(['sub', 'match']);
    expect(align('ab', 'abc').map((o) => o.type)).toEqual(['match', 'match', 'ins']);
  });
});

describe('analyzeKeyboard', () => {
  it('teclado ABNT2 com layout ABNT2: as teclas batem', () => {
    const a = analyzeKeyboard({
      typed: REFERENCE_TEXT,
      charCode: ABNT2_ON_ABNT2,
      codesSeen: new Set(['IntlRo', 'Semicolon']),
      layoutId: '00010416',
      layoutKeys: new Map(),
    });
    expect(a.physical).toBe('abnt2');
    expect(a.configured).toBe('abnt2');
    expect(a.verdict).toBe('ok');
    expect(a.differences).toEqual([]);
    expect(a.message).toBe('As teclas batem com o layout configurado.');
  });

  it('teclado ABNT2 com o Windows em inglês (EUA): aponta o layout errado', () => {
    // O usuário aperta as teclas impressas no ABNT2; o layout dos EUA escreve outra coisa, e a
    // tecla "/?" (IntlRo) não escreve nada.
    const typed = "Ma;'a/ p[e? 12 ]ok\\ }sim| \\ | `a` ~b~";
    const a = analyzeKeyboard({
      typed,
      charCode: codes({
        ';': 'Semicolon', "'": 'Quote', '/': 'Slash', '[': 'BracketLeft', '?': 'Slash', ']': 'BracketRight',
        '\\': ['Backslash', 'IntlBackslash'], '}': 'BracketRight', '|': ['Backslash', 'IntlBackslash'], '`': 'Backquote', '~': 'Backquote',
      }),
      codesSeen: new Set(['IntlRo', 'IntlBackslash', 'Semicolon']),
      layoutId: '00000409',
      layoutKeys: new Map(),
    });
    expect(a.physical).toBe('abnt2');
    expect(a.configured).toBe('us');
    expect(a.verdict).toBe('mismatch');
    expect(a.message).toContain('Ajuste o layout para Português (Brasil ABNT2)');
    expect(a.differences.map(describeDifference)).toContain('A tecla “ç” escreveu “;” (tecla Semicolon)');
    expect(a.differences.map(describeDifference)).toContain('A tecla “/” não escreveu nada');
    expect(a.differences.map(describeDifference)).toContain('A tecla “ã” escreveu “\'a” (tecla Quote)');
    expect(a.differences.map(describeDifference)).toContain('A tecla “;” escreveu “/” (tecla Slash)');
  });

  it('teclado americano com layout dos EUA: sem Ç e sem acento não é defeito', () => {
    const a = analyzeKeyboard({
      typed: 'Maca; pe: 1/2? [ok] {sim} \\ | \'a\' "b"',
      charCode: codes({
        ';': 'Semicolon', ':': 'Semicolon', '/': 'Slash', '?': 'Slash', '[': 'BracketLeft', '{': 'BracketLeft',
        ']': 'BracketRight', '}': 'BracketRight', '\\': 'Backslash', '|': 'Backslash', "'": 'Quote', '"': 'Quote',
      }),
      codesSeen: new Set(['Semicolon', 'Slash']),
      layoutId: 'us(intl)',
      layoutKeys: new Map(),
    });
    expect(a.physical).toBe('us');
    expect(a.configured).toBe('us-intl');
    expect(a.verdict).toBe('ok');
    expect(a.differences).toEqual([]);
  });

  it('teclado americano com layout ABNT2: aponta o layout errado', () => {
    const a = analyzeKeyboard({
      typed: 'Macaç peÇ 1;2: ók[ `sim{ ] } ã~^b',
      charCode: codes({
        'ç': 'Semicolon', 'Ç': 'Semicolon', ';': 'Slash', ':': 'Slash', '[': 'BracketRight', '{': 'BracketRight',
        ']': 'Backslash', '}': 'Backslash', 'ó': 'KeyO', 'ã': 'KeyA', '`': 'BracketLeft', '~': 'Quote', '^': 'Quote',
      }),
      codesSeen: new Set(['Semicolon', 'Slash', 'Quote']),
      layoutId: '00010416',
      layoutKeys: new Map(),
    });
    expect(a.physical).toBe('us');
    expect(a.verdict).toBe('mismatch');
    expect(a.message).toContain('o sistema está configurado como ABNT2');
  });

  it('espera o texto até o fim e não acusa o que falta digitar', () => {
    const a = analyzeKeyboard({ typed: 'Maçã;', charCode: ABNT2_ON_ABNT2, codesSeen: new Set(), layoutId: '00010416', layoutKeys: new Map() });
    expect(a.verdict).toBe('pending');
    expect(a.differences).toEqual([]);
    expect(a.ops.every((o) => o.type === 'match')).toBe(true);
  });

  it('sem o layout do sistema, deduz pelas teclas', () => {
    expect(layoutFamilyFromKeys(new Map([['Semicolon', 'ç']]))).toBe('abnt2');
    expect(layoutFamilyFromKeys(new Map([['Semicolon', ';'], ['Quote', 'Dead']]))).toBe('us-intl');
    expect(layoutFamilyFromKeys(new Map([['KeyA', 'a']]))).toBeNull();
    expect(layoutFamilyFromId('br')).toBe('abnt2');
    expect(layoutFamilyFromId('00000416')).toBe('abnt2');
    expect(layoutFamilyFromId('00020409')).toBe('us-intl');
    expect(layoutFamilyFromId('de')).toBe('other');
    expect(layoutFamilyFromId('')).toBeNull();
  });
});

describe('diagnostics', () => {
  const dev = (id: string, kind: DeviceInfo['kind'] = 'usb'): DeviceInfo => ({ id, kind, name: `Aparelho ${id}`, ok: true });

  it('percebe quem entrou e quem saiu, só entre os aparelhos USB', () => {
    const at = new Date('2026-10-27T10:00:00Z');
    const ev = diffUsb([dev('a'), dev('k', 'keyboard')], [dev('b'), dev('k2', 'keyboard')], at);
    expect(ev.map((e) => `${e.type}:${e.device.id}`)).toEqual(['in:b', 'out:a']);
  });
});
