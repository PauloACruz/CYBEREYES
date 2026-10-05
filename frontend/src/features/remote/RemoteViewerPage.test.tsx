import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteSessionDto } from '../../api/types';
import { json, makeMe, mockFetch, problem, renderApp } from '../../test/utils';
import { FRAME, jsonFrame } from './protocol';

const me = makeMe({ permissions: ['agents.view', 'agents.remote'] });

const session: RemoteSessionDto = {
  sessionId: 'a'.repeat(32),
  agentId: 1,
  hostname: 'PC-RECEPCAO',
  user: 'tecnico',
  channels: ['desktop'],
  viewOnly: false,
  state: 'starting',
  consent: 'none',
  startedAt: '2026-10-05T12:00:00Z',
  endedAt: null,
  endReason: null,
  relayUrl: '/api/remote/relay/x/desktop',
  viewerToken: 'tok',
  expiresAt: null,
  ticketId: null,
  firstFrameAt: null,
  bytesToViewer: 0,
  bytesToAgent: 0,
  clipboardToRemote: 0,
  clipboardToLocal: 0,
};

class FakeSocket {
  static readonly OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = 0;
  binaryType = 'blob';
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(data: Uint8Array) {
    this.sent.push(data);
  }
  close() {
    this.onclose?.({ code: 1000, reason: '' });
  }
}

describe('visualizador de acesso remoto', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeSocket.last = null;
  });

  it('cria a sessao, conecta ao relay e mostra o estado', async () => {
    const created = vi.fn(() => json(session, 201));
    mockFetch({
      'GET /api/auth/me': () => json(me),
      'POST /api/agents/1/remote/sessions': created,
      [`DELETE /api/remote/sessions/${session.sessionId}`]: () => new Response(null, { status: 204 }),
    });
    vi.stubGlobal('WebSocket', FakeSocket);
    renderApp('/acesso-remoto/1');

    expect(await screen.findByText('PC-RECEPCAO')).toBeInTheDocument();
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    const socket = FakeSocket.last;
    expect(socket?.url.endsWith(`/api/remote/relay/${session.sessionId}/desktop`)).toBe(true);
    socket!.readyState = FakeSocket.OPEN;
    socket!.onopen?.();
    expect(socket!.sent[0]?.[0]).toBe(FRAME.auth);
    socket!.onmessage?.({ data: new Uint8Array([FRAME.authOk]).buffer });
    expect(await screen.findAllByText('Aguardando a máquina')).not.toHaveLength(0);
    socket!.onmessage?.({ data: new Uint8Array([FRAME.paired]).buffer });
    expect(await screen.findAllByText('Conectado')).not.toHaveLength(0);
    expect(created).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+V envia o texto local antes das teclas', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(me),
      'POST /api/agents/1/remote/sessions': () => json(session, 201),
      [`DELETE /api/remote/sessions/${session.sessionId}`]: () => new Response(null, { status: 204 }),
    });
    vi.stubGlobal('WebSocket', FakeSocket);
    renderApp('/acesso-remoto/1');
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    const socket = FakeSocket.last!;
    socket.readyState = FakeSocket.OPEN;
    socket.onopen?.();
    const receive = (frame: Uint8Array) => {
      const copy = new Uint8Array(frame.length);
      copy.set(frame);
      socket.onmessage?.({ data: copy.buffer });
    };
    receive(new Uint8Array([FRAME.authOk]));
    receive(new Uint8Array([FRAME.paired]));
    receive(jsonFrame(FRAME.hello, { proto: 1, os: 'windows', displays: [{ id: 0, name: '', x: 0, y: 0, w: 800, h: 600, scale: 1, primary: true }], active: 0, features: ['desktop', 'clipboard-text'], user: null }));
    expect(await screen.findByRole('img', { name: 'Área de transferência sincronizada' })).toBeInTheDocument();

    const canvas = screen.getByTestId('remote-canvas');
    socket.sent.length = 0;
    fireEvent.keyDown(canvas, { code: 'KeyV', key: 'v', ctrlKey: true });
    fireEvent.paste(canvas, { clipboardData: { getData: () => 'texto local' } });
    await waitFor(() => expect(socket.sent.filter((f) => f[0] === FRAME.key)).toHaveLength(2));
    const types = socket.sent.map((f) => f[0]).filter((t) => t === FRAME.clipboard || t === FRAME.key);
    expect(types).toEqual([FRAME.clipboard, FRAME.key, FRAME.key]);
    const clip = JSON.parse(new TextDecoder().decode(socket.sent.find((f) => f[0] === FRAME.clipboard)?.subarray(1))) as { text: string };
    expect(clip.text).toBe('texto local');
    fireEvent.keyUp(canvas, { code: 'KeyV', key: 'v', ctrlKey: true });
    expect(socket.sent.filter((f) => f[0] === FRAME.key)).toHaveLength(2);
  });

  it('explica quando a maquina esta desconectada', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(me),
      'POST /api/agents/1/remote/sessions': () => problem(409, 'AGENT_OFFLINE', 'Agente offline'),
    });
    vi.stubGlobal('WebSocket', FakeSocket);
    renderApp('/acesso-remoto/1');
    expect(await screen.findByText('A máquina está desconectada.')).toBeInTheDocument();
    expect(FakeSocket.last).toBeNull();
  });
});
