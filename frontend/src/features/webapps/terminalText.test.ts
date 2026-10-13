import { describe, expect, it } from 'vitest';
import { cleanTerminalText } from './terminalText';

describe('cleanTerminalText', () => {
  it('remove cores e deixa só o último estado das barras de progresso', () => {
    const esc = String.fromCharCode(27);
    const raw = `${esc}[32mok${esc}[0m\r\nbaixando 10%\rbaixando 55%\rbaixando 100%\nfim`;
    expect(cleanTerminalText(raw)).toBe('ok\nbaixando 100%\nfim');
  });
});
