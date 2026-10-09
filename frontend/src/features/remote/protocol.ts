// Quadros do relay do acesso remoto (docs/remoto/contrato-remoto.md, secoes 4 a 6):
// 1 byte de tipo seguido de JSON UTF-8 ou de corpo binario (inteiros em big-endian).

export const FRAME = {
  auth: 0x01,
  authOk: 0x02,
  paired: 0x03,
  peerGone: 0x04,
  hello: 0x10,
  tile: 0x11,
  frameEnd: 0x12,
  cursor: 0x13,
  clipboard: 0x14,
  displays: 0x15,
  consent: 0x16,
  filesCopied: 0x17,
  bye: 0x18,
  error: 0x19,
  audio: 0x1a,
  settings: 0x20,
  key: 0x21,
  text: 0x22,
  mouse: 0x23,
  wheel: 0x24,
  refresh: 0x25,
  cad: 0x26,
  ack: 0x27,
} as const;

export const CLOSE = {
  auth: 4401,
  forbidden: 4403,
  peerTimeout: 4408,
  duplicate: 4409,
  ended: 4410,
  tooLarge: 4413,
  rate: 4429,
} as const;

export interface RemoteDisplay {
  id: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  primary: boolean;
}

export interface HelloBody {
  proto: number;
  os: 'windows' | 'linux' | 'darwin';
  displays: RemoteDisplay[];
  active: number;
  features: string[];
  user: string | null;
}

export interface TileFrame {
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
  jpeg: Uint8Array<ArrayBuffer>;
}

export interface FrameEndFrame {
  frame: number;
  tiles: number;
  width: number;
  height: number;
}

/** CURSOR (contrato, secao 5.1): ponto ativo em pixels do quadro; png so na primeira vez de cada id. */
export interface CursorBody {
  visible: boolean;
  x: number;
  y: number;
  id: number;
  hotX: number;
  hotY: number;
  png: string | null;
}

export interface ClipboardBody {
  kind: 'text' | 'png';
  text?: string;
  hash: string;
}

export interface FilesCopiedBody {
  paths: string[];
  totalBytes: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function jsonFrame(type: number, body: unknown): Uint8Array<ArrayBuffer> {
  const json = encoder.encode(JSON.stringify(body));
  const frame = new Uint8Array(json.length + 1);
  frame[0] = type;
  frame.set(json, 1);
  return frame;
}

export function readJson(frame: Uint8Array): unknown {
  return JSON.parse(decoder.decode(frame.subarray(1)));
}

export function parseTile(frame: Uint8Array<ArrayBuffer>): TileFrame {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  return {
    frame: view.getUint32(1),
    x: view.getUint16(5),
    y: view.getUint16(7),
    w: view.getUint16(9),
    h: view.getUint16(11),
    jpeg: frame.subarray(13),
  };
}

export function parseFrameEnd(frame: Uint8Array): FrameEndFrame {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  return { frame: view.getUint32(1), tiles: view.getUint16(5), width: view.getUint16(7), height: view.getUint16(9) };
}

export function ackFrame(frame: number, receivedMs: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(9);
  const view = new DataView(out.buffer);
  out[0] = FRAME.ack;
  view.setUint32(1, frame);
  view.setUint32(5, receivedMs >>> 0);
  return out;
}

/** SHA-256 em hexadecimal, usado para evitar eco na area de transferencia. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
