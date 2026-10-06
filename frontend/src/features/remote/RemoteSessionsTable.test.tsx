import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteSessionDto } from '../../api/types';
import { makeAgentDetail } from '../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

const base: RemoteSessionDto = {
  sessionId: 'a'.repeat(32),
  agentId: 1,
  hostname: 'PC-01',
  user: 'tecnico',
  channels: ['desktop'],
  viewOnly: false,
  state: 'ended',
  consent: 'ask',
  startedAt: '2026-10-05T12:00:00Z',
  endedAt: '2026-10-05T12:20:00Z',
  endReason: 'consent-denied',
  relayUrl: null,
  viewerToken: null,
  expiresAt: null,
  ticketId: null,
  firstFrameAt: null,
  bytesToViewer: 0,
  bytesToAgent: 0,
  clipboardToRemote: 0,
  clipboardToLocal: 0,
};

describe('historico de acessos remotos do agente', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lista as sessoes com duracao e motivo do fim', async () => {
    const seen: URL[] = [];
    const list = vi.fn((_: RequestInit | undefined, url: URL) => {
      seen.push(url);
      return json({ items: [base, { ...base, sessionId: 'b'.repeat(32), state: 'active', endedAt: null, endReason: null, viewOnly: true }], total: 2, page: 1, pageSize: 50 });
    });
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view'] })),
      'GET /api/agents/1': () => json(makeAgentDetail()),
      'GET /api/remote/sessions': list,
    });
    renderApp('/agentes/1?aba=acessos');
    expect(await screen.findByText('O usuário recusou o acesso.')).toBeInTheDocument();
    expect(screen.getByText('20 min')).toBeInTheDocument();
    expect(screen.getByText('Em andamento')).toBeInTheDocument();
    expect(screen.getByText('Visualização')).toBeInTheDocument();
    expect(seen[0]?.searchParams.get('agentId')).toBe('1');
  });
});
