import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIENTS, makeAgent } from '../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

const agents = [
  makeAgent(),
  makeAgent({
    id: 2,
    agentId: 'agent-2',
    hostname: 'SRV-ARQUIVOS',
    monitoringType: 'server',
    plat: 'linux',
    operatingSystem: 'Ubuntu 24.04 LTS',
    status: 'overdue',
    loggedInUsername: 'None',
    lastLoggedInUser: 'root',
    needsReboot: true,
  }),
];

describe('lista de agentes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra status com texto, colunas e aplica o filtro de status', async () => {
    const fetchMock = mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view'] })),
      'GET /api/clients': () => json(CLIENTS),
      'GET /api/agents': (_, url) => {
        const status = url.searchParams.get('status');
        const items = status ? agents.filter((a) => a.status === status) : agents;
        return json({ items, total: items.length, page: 1, pageSize: 50 });
      },
    });
    renderApp('/agentes');

    const row = (await screen.findByText('SRV-ARQUIVOS')).closest('tr');
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement);
    expect(cells.getByText('Em atraso')).toBeInTheDocument();
    expect(cells.getByText('Servidor')).toBeInTheDocument();
    expect(cells.getByText('Ubuntu 24.04 LTS')).toBeInTheDocument();
    expect(cells.getByRole('img', { name: 'Linux' })).toBeInTheDocument();
    expect(cells.getByText('root')).toBeInTheDocument();
    expect(cells.getByText('Pendente')).toBeInTheDocument();
    const firstRow = screen.getByText('PC-RECEPCAO').closest('tr') as HTMLElement;
    expect(within(firstRow).getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('2 agentes')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Buscar agentes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Instalar agente' })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Filtrar por status' }));
    await user.click(await screen.findByRole('option', { name: 'Em atraso', hidden: true }));

    await waitFor(() => expect(screen.queryByText('PC-RECEPCAO')).not.toBeInTheDocument());
    expect(screen.getByText('SRV-ARQUIVOS')).toBeInTheDocument();
    const urls = fetchMock.mock.calls.map(([input]) => (typeof input === 'string' ? input : ''));
    expect(urls.some((u) => u.startsWith('/api/agents?') && u.includes('status=overdue'))).toBe(true);
  });
});
