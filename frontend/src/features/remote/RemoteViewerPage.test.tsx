import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    fireEvent.paste(canvas, { clipboardData: { getData: () => 'texto local', files: [] } });
    await waitFor(() => expect(socket.sent.filter((f) => f[0] === FRAME.key)).toHaveLength(2));
    const types = socket.sent.map((f) => f[0]).filter((t) => t === FRAME.clipboard || t === FRAME.key);
    expect(types).toEqual([FRAME.clipboard, FRAME.key, FRAME.key]);
    const clip = JSON.parse(new TextDecoder().decode(socket.sent.find((f) => f[0] === FRAME.clipboard)?.subarray(1))) as { text: string };
    expect(clip.text).toBe('texto local');
    fireEvent.keyUp(canvas, { code: 'KeyV', key: 'v', ctrlKey: true });
    expect(socket.sent.filter((f) => f[0] === FRAME.key)).toHaveLength(2);
  });

  it('pede o cursor separado e junta os movimentos do mouse', async () => {
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
    receive(new Uint8Array([FRAME.paired]));
    receive(jsonFrame(FRAME.hello, { proto: 1, os: 'windows', displays: [{ id: 0, name: '', x: 0, y: 0, w: 800, h: 600, scale: 1, primary: true }], active: 0, features: ['desktop', 'cursor'], user: null }));
    const settings = () =>
      socket.sent.filter((f) => f[0] === FRAME.settings).map((f) => JSON.parse(new TextDecoder().decode(f.subarray(1))) as { cursor: boolean; maxFps: number });
    await waitFor(() => expect(settings().at(-1)).toMatchObject({ cursor: true, maxFps: 24 }));

    const canvas = screen.getByTestId('remote-canvas');
    socket.sent.length = 0;
    // Relogio parado durante a rajada: o resultado nao depende da carga da maquina.
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    try {
      for (let i = 0; i < 20; i++) fireEvent.pointerMove(canvas, { clientX: i, clientY: i, buttons: 0 });
      const mouse = () => socket.sent.filter((f) => f[0] === FRAME.mouse);
      expect(mouse().length).toBeLessThanOrEqual(2);
      // O clique sai na hora, depois do movimento pendente.
      fireEvent.pointerDown(canvas, { clientX: 30, clientY: 30, buttons: 1 });
      const last = JSON.parse(new TextDecoder().decode(mouse().at(-1)?.subarray(1))) as { buttons: number };
      expect(last.buttons).toBe(1);
      expect(mouse()).toHaveLength(3);
    } finally {
      clock.mockRestore();
    }
  });

  it('liga o som da maquina pelo botao e pede o audio ao agente', async () => {
    class FakeContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      resume = () => Promise.resolve();
      close = () => Promise.resolve();
    }
    vi.stubGlobal('AudioContext', FakeContext);
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
    receive(new Uint8Array([FRAME.paired]));
    receive(jsonFrame(FRAME.hello, { proto: 1, os: 'windows', displays: [{ id: 0, name: '', x: 0, y: 0, w: 800, h: 600, scale: 1, primary: true }], active: 0, features: ['desktop', 'audio'], user: null }));
    const settings = () =>
      socket.sent.filter((f) => f[0] === FRAME.settings).map((f) => JSON.parse(new TextDecoder().decode(f.subarray(1))) as { audio: boolean });
    await waitFor(() => expect(settings().at(-1)).toMatchObject({ audio: false }));

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Som' }));
    await waitFor(() => expect(settings().at(-1)).toMatchObject({ audio: true }));
    expect(screen.getByRole('button', { name: 'Som' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Som' }));
    await waitFor(() => expect(settings().at(-1)).toMatchObject({ audio: false }));
  });

  it('arquivos copiados na estacao viram um link para baixar', async () => {
    const created: unknown[] = [];
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view', 'agents.remote', 'agents.files'] })),
      'POST /api/agents/1/remote/sessions': (init) => {
        created.push(JSON.parse(init?.body as string));
        return json({ ...session, channels: ['desktop', 'files'] }, 201);
      },
      [`DELETE /api/remote/sessions/${session.sessionId}`]: () => new Response(null, { status: 204 }),
      [`GET /api/remote/sessions/${session.sessionId}/files/home`]: () => json({ desktop: 'C:\\D', home: 'C:\\H', downloads: 'C:\\W', separator: '\\' }),
    });
    vi.stubGlobal('WebSocket', FakeSocket);
    renderApp('/acesso-remoto/1');
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    expect(created[0]).toMatchObject({ channels: ['desktop', 'files'] });
    const socket = FakeSocket.last!;
    socket.readyState = FakeSocket.OPEN;
    socket.onopen?.();
    socket.onmessage?.({ data: new Uint8Array([FRAME.paired]).buffer });
    const frame = jsonFrame(FRAME.filesCopied, { paths: ['C:\\Users\\maria\\Desktop\\nota.txt'], totalBytes: 1024 });
    const copy = new Uint8Array(frame.length);
    copy.set(frame);
    socket.onmessage?.({ data: copy.buffer });
    const link = await screen.findByRole('link', { name: 'Baixar' });
    expect(link.getAttribute('href')).toBe(`/api/remote/sessions/${session.sessionId}/download?path=${encodeURIComponent('C:\\Users\\maria\\Desktop\\nota.txt')}`);
    expect(screen.getByRole('button', { name: 'Arquivos' })).toBeInTheDocument();
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
