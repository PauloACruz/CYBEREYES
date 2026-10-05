import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteSessionDto } from '../../api/types';
import { json, makeMe, mockFetch, problem, renderApp } from '../../test/utils';
import { FRAME } from './protocol';

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
