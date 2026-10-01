import { describe, expect, it } from 'vitest';
import { decodeBase64 } from './terminalCodec';

describe('decodeBase64', () => {
  it('converte base64 em bytes, incluindo UTF-8 multibyte e sequências ANSI', () => {
    const bytes = decodeBase64('G1szMm1PbMOhIOKclAobWzBt');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes.slice(0, 5))).toEqual([0x1b, 0x5b, 0x33, 0x32, 0x6d]);
    expect(new TextDecoder().decode(bytes)).toBe('\x1b[32mOlá ✔\n\x1b[0m');
  });

  it('devolve um array vazio para entrada vazia', () => {
    expect(decodeBase64('')).toEqual(new Uint8Array(0));
  });
});
