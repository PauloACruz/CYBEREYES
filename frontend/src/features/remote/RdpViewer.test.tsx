import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteSessionDto } from '../../api/types';
import { json, makeMe, mockFetch, problem, renderApp } from '../../test/utils';
import { rdpErrorMessage, startRdp, type RdpTarget } from './rdpClient';

vi.mock('./rdpClient', async (original) => {
  const real = await original<typeof import('./rdpClient')>();
  return { ...real, startRdp: vi.fn() };
});

const me = makeMe({ permissions: ['agents.view', 'agents.remote'] });

const session: RemoteSessionDto = {
  sessionId: 'b'.repeat(32),
  agentId: 1,
  hostname: 'NOTE-WAYLAND',
  user: 'tecnico',
  channels: ['rdp'],
  viewOnly: false,
  state: 'starting',
  consent: 'ask',
  startedAt: '2026-10-05T12:00:00Z',
  endedAt: null,
  endReason: null,
  relayUrl: '/api/remote/relay/x',
  viewerToken: 'token-visualizador',
  expiresAt: null,
  ticketId: null,
  firstFrameAt: null,
  bytesToViewer: 0,
  bytesToAgent: 0,
  clipboardToRemote: 0,
  clipboardToLocal: 0,
  rdp: { destination: 'NOTE-WAYLAND', username: 'eyes', password: 'SenhaTemporaria1', user: 'maria', clipboard: true },
};

describe('RDP do GNOME no visualizador', () => {
  beforeEach(() => {
    vi.mocked(startRdp).mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('com sessao Wayland, troca para o RDP e conecta pelo canal rdp do relay', async () => {
    const bodies: unknown[] = [];
    let state: RemoteSessionDto['state'] = 'waiting-consent';
    mockFetch({
      'GET /api/auth/me': () => json(me),
      'POST /api/agents/1/remote/sessions': (init?: RequestInit) => {
        const body = JSON.parse(init?.body as string) as { channels: string[] };
        bodies.push(body);
        return body.channels.includes('desktop')
          ? problem(409, 'REMOTE_WAYLAND', 'Sessao Wayland: a tela desta maquina vai pelo RDP do GNOME')
          : json(session, 201);
      },
      [`GET /api/remote/sessions/${session.sessionId}`]: () => json({ ...session, state }),
      [`DELETE /api/remote/sessions/${session.sessionId}`]: () => new Response(null, { status: 204 }),
    });
    let connect: (() => void) | undefined;
    const close = vi.fn();
    vi.mocked(startRdp).mockImplementation(
      () =>
        new Promise((resolve) => {
          connect = () => resolve({ ui: { ctrlAltDel: vi.fn() } as never, done: new Promise(() => undefined), close });
        }),
    );
    renderApp('/acesso-remoto/1');

    expect(await screen.findByText('NOTE-WAYLAND')).toBeInTheDocument();
    expect(screen.getByText('RDP do GNOME')).toBeInTheDocument();
    expect(bodies).toEqual([
      { channels: ['desktop'], viewOnly: false, ticketId: null },
      { channels: ['rdp'], viewOnly: false, ticketId: null },
    ]);
    await waitFor(() => expect(startRdp).toHaveBeenCalledTimes(1));
    const target = vi.mocked(startRdp).mock.calls[0]?.[1] as RdpTarget;
    expect(target.proxyAddress.endsWith(`/api/remote/relay/${session.sessionId}/rdp`)).toBe(true);
    expect(target).toMatchObject({ authToken: 'token-visualizador', username: 'eyes', password: 'SenhaTemporaria1', clipboard: true });

    // O pedido de acesso aparece pelo estado da sessao na API.
    expect(await screen.findAllByText('Aguardando o usuário aceitar')).not.toHaveLength(0);
    state = 'active';
    connect?.();
    expect(await screen.findAllByText('Conectado', {}, { timeout: 5000 })).not.toHaveLength(0);
  });

  it('mostra o motivo quando o usuario recusa', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(me),
      'POST /api/agents/1/remote/sessions': () => json(session, 201),
      [`GET /api/remote/sessions/${session.sessionId}`]: () => json({ ...session, state: 'ended', endReason: 'consent-denied' }),
      [`DELETE /api/remote/sessions/${session.sessionId}`]: () => new Response(null, { status: 204 }),
    });
    vi.mocked(startRdp).mockImplementation(() => new Promise(() => undefined));
    renderApp('/acesso-remoto/1?rdp=1');
    expect(await screen.findByText('O usuário recusou o acesso.')).toBeInTheDocument();
  });

  it('traduz os erros do cliente RDP', () => {
    const iron = (kind: number, httpStatusCode?: number) => ({
      kind: () => kind,
      backtrace: () => '',
      rdcleanpathDetails: () => (httpStatusCode === undefined ? undefined : { httpStatusCode }),
    });
    expect(rdpErrorMessage(iron(1))).toContain('credencial temporária');
    expect(rdpErrorMessage(iron(4, 401))).toContain('autenticação da sessão falhou');
    expect(rdpErrorMessage(iron(4, 502))).toContain('não conseguiu falar com o RDP do GNOME');
    expect(rdpErrorMessage(new Error('x'))).toBe('Não foi possível abrir o RDP do GNOME.');
  });
});
