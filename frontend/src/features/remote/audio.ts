// Som da maquina acessada (contrato, secao 5.1, AUDIO): IMA ADPCM, quadros de 40 ms, tocados pelo Web Audio.

const STEPS = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552,
  1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
  12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const INDEX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

export interface AudioChunk {
  sampleRate: number;
  seq: number;
  /** Amostras de cada canal entre -1 e 1. */
  channels: Float32Array<ArrayBuffer>[];
}

/** Decodifica o quadro AUDIO inteiro (com o byte de tipo). Devolve null para codec desconhecido ou quadro curto. */
export function decodeAudio(frame: Uint8Array): AudioChunk | null {
  if (frame.length < 13 || frame[1] !== 1) return null;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const count = frame[2] ?? 0;
  const sampleRate = view.getUint32(3);
  const seq = view.getUint32(7);
  const frames = view.getUint16(11);
  const per = 4 + frames / 2;
  if (count === 0 || frame.length < 13 + count * per) return null;
  const channels: Float32Array<ArrayBuffer>[] = [];
  for (let c = 0; c < count; c++) {
    const base = 13 + c * per;
    let predictor = view.getInt16(base);
    let index = frame[base + 2] ?? 0;
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const byte = frame[base + 4 + (i >> 1)] ?? 0;
      const nibble = i % 2 === 0 ? byte & 0x0f : byte >> 4;
      const step = STEPS[index] ?? 7;
      let delta = step >> 3;
      if (nibble & 4) delta += step;
      if (nibble & 2) delta += step >> 1;
      if (nibble & 1) delta += step >> 2;
      predictor += nibble & 8 ? -delta : delta;
      predictor = Math.max(-32768, Math.min(32767, predictor));
      index = Math.max(0, Math.min(88, index + (INDEX[nibble] ?? 0)));
      out[i] = predictor / 32768;
    }
    channels.push(out);
  }
  return { sampleRate, seq, channels };
}

// Folga inicial (absorve variacao da rede) e atraso maximo antes de descartar para alcancar o tempo real.
const START_DELAY = 0.12;
const MAX_DELAY = 0.6;

/** Toca os quadros AUDIO em sequencia. O AudioContext so pode nascer num clique (politica dos navegadores). */
export class AudioPlayer {
  private context: AudioContext | null = null;
  private next = 0;

  /** Cria ou retoma o AudioContext; chame dentro do clique que liga o som. */
  async start(): Promise<boolean> {
    if (typeof AudioContext === 'undefined') return false;
    this.context ??= new AudioContext({ latencyHint: 'interactive' });
    await this.context.resume().catch(() => undefined);
    this.next = 0;
    return true;
  }

  push(frame: Uint8Array): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') return;
    const chunk = decodeAudio(frame);
    if (!chunk || chunk.channels.length === 0) return;
    const length = chunk.channels[0]?.length ?? 0;
    if (length === 0) return;
    const now = ctx.currentTime;
    if (this.next < now + 0.02) this.next = now + START_DELAY;
    if (this.next > now + MAX_DELAY) return; // atrasado demais: descarta para nao ficar defasado da tela
    const buffer = ctx.createBuffer(chunk.channels.length, length, chunk.sampleRate);
    chunk.channels.forEach((data, c) => buffer.copyToChannel(data, c));
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(this.next);
    this.next += length / chunk.sampleRate;
  }

  stop(): void {
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
