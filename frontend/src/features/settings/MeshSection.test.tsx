import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDateTime } from '../../lib/format';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

describe('seção de acesso remoto nas configurações', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra o status do MeshCentral e sincroniza sob demanda', async () => {
    const sync = vi.fn(() => json({ lastSync: '2026-10-01T15:00:00Z', lastError: null, users: 4 }));
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['settings.manage'] })),
      'GET /api/mesh/status': () =>
        json({
          enabled: true,
          url: 'https://mesh.example.com',
          deviceGroup: 'Cybereyes',
          groupId: 'mesh//abc',
          lastSync: '2026-10-01T12:00:00Z',
          lastError: 'Falha ao conectar no MeshCentral',
          users: 3,
        }),
      'POST /api/mesh/sync': sync,
      'GET /api/ticket-queues': () => json([]),
      'GET /api/tickets/sla': () => json([]),
      'GET /api/tickets/incident-settings': () =>
        json({ enabled: true, severities: ['error'], priority: 'high', queueId: null, resolveWithAlert: true }),
    });
    renderApp('/configuracoes');

    const section = await screen.findByRole('region', { name: 'Acesso remoto (MeshCentral)' });
    expect(await within(section).findByText('https://mesh.example.com')).toBeInTheDocument();
    expect(within(section).getByText('Habilitado')).toBeInTheDocument();
    expect(within(section).getByText('Cybereyes')).toBeInTheDocument();
    expect(within(section).getByText('3')).toBeInTheDocument();
    expect(within(section).getByText(formatDateTime('2026-10-01T12:00:00Z'))).toBeInTheDocument();
    expect(within(section).getByText('Falha ao conectar no MeshCentral')).toBeInTheDocument();

    await userEvent.setup().click(within(section).getByRole('button', { name: 'Sincronizar agora' }));

    expect(sync).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Sincronização com o MeshCentral concluída.')).toBeInTheDocument();
  });
});
