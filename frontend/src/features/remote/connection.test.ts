import { describe, expect, it, vi } from 'vitest';
import { closeReason, RemoteConnection, relayUrl, type ConnectionHandlers } from './connection';
import { CLOSE, FRAME, jsonFrame } from './protocol';

class FakeSocket {
  static readonly OPEN = 1;
  readyState = 0;
  binaryType = 'blob';
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  send(data: Uint8Array) {
    this.sent.push(data);
  }
  close() {
    this.onclose?.({ code: 1000, reason: '' });
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  receive(frame: Uint8Array) {
    const copy = new Uint8Array(frame.length);
    copy.set(frame);
    this.onmessage?.({ data: copy.buffer });
  }
}

function handlers() {
  return {
    onPhase: vi.fn<ConnectionHandlers['onPhase']>(),
    onHello: vi.fn<ConnectionHandlers['onHello']>(),
    onDisplays: vi.fn<ConnectionHandlers['onDisplays']>(),
    onTile: vi.fn<ConnectionHandlers['onTile']>(),
    onFrameEnd: vi.fn<ConnectionHandlers['onFrameEnd']>(() => Promise.resolve()),
    onConsent: vi.fn<ConnectionHandlers['onConsent']>(),
    onClipboard: vi.fn<ConnectionHandlers['onClipboard']>(),
    onFilesCopied: vi.fn<ConnectionHandlers['onFilesCopied']>(),
    onError: vi.fn<ConnectionHandlers['onError']>(),
    onClosed: vi.fn<ConnectionHandlers['onClosed']>(),
  } satisfies ConnectionHandlers;
}

function setup() {
  vi.stubGlobal('WebSocket', FakeSocket);
  const socket = new FakeSocket();
  const h = handlers();
  const conn = new RemoteConnection('ws://x/api/remote/relay/s/desktop', 'tok', h, () => socket as unknown as WebSocket);
  conn.connect();
  return { socket, h, conn };
}

function frameEnd(frame: number): Uint8Array {
  const out = new Uint8Array(13);
  const view = new DataView(out.buffer);
  out[0] = FRAME.frameEnd;
  view.setUint32(1, frame);
  view.setUint16(5, 1);
  view.setUint16(7, 800);
  view.setUint16(9, 600);
  return out;
}

describe('RemoteConnection', () => {
  it('autentica ao abrir e segue as fases do relay', () => {
    const { socket, h } = setup();
    socket.open();
    expect(socket.sent[0]?.[0]).toBe(FRAME.auth);
    expect(JSON.parse(new TextDecoder().decode(socket.sent[0]?.subarray(1)))).toEqual({ token: 'tok', role: 'viewer', proto: 1 });
    socket.receive(new Uint8Array([FRAME.authOk]));
    socket.receive(new Uint8Array([FRAME.paired]));
    expect(h.onPhase.mock.calls.map((c) => c[0])).toEqual(['connecting', 'waiting-agent', 'connected']);
  });

  it('repassa HELLO, consentimento e erro do agente', () => {
    const { socket, h } = setup();
    socket.open();
    socket.receive(jsonFrame(FRAME.hello, { proto: 1, os: 'linux', displays: [], active: 0, features: [], user: null }));
    socket.receive(jsonFrame(FRAME.consent, { state: 'waiting' }));
    socket.receive(jsonFrame(FRAME.error, { code: 'CAPTURE', message: 'falhou' }));
    expect(h.onHello).toHaveBeenCalledWith(expect.objectContaining({ os: 'linux' }));
    expect(h.onConsent).toHaveBeenCalledWith('waiting');
    expect(h.onError).toHaveBeenCalledWith('CAPTURE', 'falhou');
  });

  it('envia o ACK so depois de desenhar o quadro', async () => {
    const { socket, h } = setup();
    socket.open();
    let finish: () => void = () => undefined;
    h.onFrameEnd.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    socket.receive(frameEnd(7));
    await Promise.resolve();
    expect(socket.sent.some((f) => f[0] === FRAME.ack)).toBe(false);
    finish();
    await vi.waitFor(() => expect(socket.sent.some((f) => f[0] === FRAME.ack)).toBe(true));
    const ack = socket.sent.find((f) => f[0] === FRAME.ack);
    expect(ack && new DataView(ack.buffer, ack.byteOffset).getUint32(1)).toBe(7);
  });

  it('explica o fechamento pelo codigo do relay', () => {
    const { socket, h } = setup();
    socket.open();
    socket.onclose?.({ code: CLOSE.ended, reason: 'consent-denied' });
    expect(h.onClosed).toHaveBeenCalledWith('O usuário recusou o acesso.');
    expect(closeReason(CLOSE.forbidden, '')).toMatch(/permissão/);
  });

  it('fechamento pelo tecnico nao vira erro', () => {
    const { socket, h, conn } = setup();
    socket.open();
    conn.close();
    expect(h.onClosed).toHaveBeenCalledWith('Sessão encerrada.');
  });

  it('monta o endereco do relay na mesma origem', () => {
    expect(relayUrl('abc', { protocol: 'https:', host: 'rmm.exemplo' })).toBe('wss://rmm.exemplo/api/remote/relay/abc/desktop');
    expect(relayUrl('abc', { protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/api/remote/relay/abc/desktop');
  });
});
