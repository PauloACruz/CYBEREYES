import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

describe('relatorio do acesso remoto', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lista sessoes e transferencias com o hash', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['reports.view', 'agents.view'] })),
      'GET /api/reports/types': () => json([]),
      'GET /api/remote/sessions': () => json({ items: [], total: 0, page: 1, pageSize: 50 }),
      'GET /api/remote/transfers': () =>
        json({
          items: [
            {
              id: 1, sessionId: 'a', agentId: 1, hostname: 'PC-01', username: 'tecnico', direction: 'upload', remotePath: 'C:\\Users\\maria\\Desktop\\a.pdf',
              sizeBytes: 2048, sha256: 'abc', startedAt: '2026-10-05T12:00:00Z', finishedAt: '2026-10-05T12:00:05Z', status: 'done', error: null,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 50,
        }),
    });
    renderApp('/relatorios?aba=acessos');
    expect(await screen.findByText('C:\\Users\\maria\\Desktop\\a.pdf')).toBeInTheDocument();
    expect(screen.getByText('Envio')).toBeInTheDocument();
    expect(screen.getByText('Concluída')).toBeInTheDocument();
    expect(await screen.findByText('Nenhum acesso remoto registrado.')).toBeInTheDocument();
  });
});
