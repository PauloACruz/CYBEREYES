import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer, decodeAudio } from './audio';

// Quadro AUDIO gerado pelo codificador do EYES (Go): 8 amostras por canal, sequencia 7.
const FRAME = '1a010200005dc0000000070008000000007077777700000000f0ffffff';
const PCM = [0, 0, 11, -11, 41, -41, 104, -104, 240, -240, 533, -533, 1164, -1164, 2521, -2521];

function hex(s: string): Uint8Array {
  return Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));
}

describe('som da maquina', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('decodifica igual ao codificador do EYES', () => {
    const chunk = decodeAudio(hex(FRAME));
    expect(chunk).not.toBeNull();
    expect(chunk?.sampleRate).toBe(24000);
    expect(chunk?.seq).toBe(7);
    const [left, right] = chunk?.channels ?? [];
    const got = Array.from({ length: 8 }, (_, i) => [Math.round((left?.[i] ?? 0) * 32768), Math.round((right?.[i] ?? 0) * 32768)]).flat();
    expect(got).toEqual(PCM);
    expect(decodeAudio(new Uint8Array([0x1a, 9, 2]))).toBeNull();
  });

  it('agenda os quadros em sequencia e descarta o atraso grande', async () => {
    const starts: number[] = [];
    class FakeContext {
      state = 'running';
      currentTime = 10;
      destination = {};
      resume = () => Promise.resolve();
      close = () => Promise.resolve();
      createBuffer = () => ({ copyToChannel: () => undefined });
      createBufferSource = () => ({ buffer: null, connect: () => undefined, start: (t: number) => starts.push(t) });
    }
    vi.stubGlobal('AudioContext', FakeContext);
    const player = new AudioPlayer();
    expect(await player.start()).toBe(true);
    const frame = hex(FRAME);
    for (let i = 0; i < 40; i++) player.push(frame);
    expect(starts[0]).toBeCloseTo(10.12, 5);
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeCloseTo(8 / 24000, 6);
    // 8 amostras = 0,33 ms por quadro: os 40 cabem na folga de 0,6 s.
    expect(starts).toHaveLength(40);
    player.stop();
  });
});
