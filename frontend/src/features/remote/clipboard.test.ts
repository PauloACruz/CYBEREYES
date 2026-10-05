import { describe, expect, it, vi } from 'vitest';
import { ClipboardBridge, MAX_CLIPBOARD_BYTES, sha256Hex } from './clipboard';
import type { ClipboardBody } from './protocol';

function setup(writeOk = true) {
  const sent: ClipboardBody[] = [];
  const api = {
    writeText: vi.fn(() => (writeOk ? Promise.resolve() : Promise.reject(new Error('sem gesto')))),
    readText: vi.fn(() => Promise.resolve('lido no foco')),
  };
  const bridge = new ClipboardBridge((b) => sent.push(b), api);
  bridge.enabled = true;
  return { bridge, api, sent };
}

describe('ClipboardBridge', () => {
  it('grava o texto da estacao e nao devolve o mesmo texto (sem eco)', async () => {
    const { bridge, api, sent } = setup();
    expect(await bridge.fromRemote({ kind: 'text', text: 'da estação', hash: 'x' })).toBe(true);
    expect(api.writeText).toHaveBeenCalledWith('da estação');
    expect(await bridge.local('da estação')).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('envia o texto local com o hash SHA-256', async () => {
    const { bridge, sent } = setup();
    expect(await bridge.local('abc')).toBe(true);
    expect(sent).toEqual([{ kind: 'text', text: 'abc', hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }]);
    expect(await bridge.local('abc')).toBe(false);
  });

  it('guarda para o proximo gesto quando o navegador recusa a gravacao', async () => {
    const { bridge, api } = setup(false);
    expect(await bridge.fromRemote({ kind: 'text', text: 'pendente', hash: 'x' })).toBe(false);
    expect(bridge.hasPending).toBe(true);
    api.writeText.mockImplementation(() => Promise.resolve());
    await bridge.flushPending();
    expect(api.writeText).toHaveBeenLastCalledWith('pendente');
    expect(bridge.hasPending).toBe(false);
  });

  it('nao envia quando a estacao nao anuncia a area de transferencia, nem acima de 1 MiB', async () => {
    const { bridge, sent } = setup();
    bridge.enabled = false;
    expect(await bridge.local('desligado')).toBe(false);
    bridge.enabled = true;
    expect(await bridge.local('a'.repeat(MAX_CLIPBOARD_BYTES + 1))).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('calcula o SHA-256 em hexadecimal', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
