import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { personPath } from '../../app/paths';
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

  it('ordena pela coluna clicada no servidor e alterna o sentido', async () => {
    const requested: string[] = [];
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view'] })),
      'GET /api/clients': () => json(CLIENTS),
      'GET /api/agents': (_, url) => {
        requested.push(`${url.searchParams.get('sortBy') ?? ''} ${url.searchParams.get('sortDir') ?? ''}`);
        const items = url.searchParams.get('sortDir') === 'desc' ? [...agents].reverse() : agents;
        return json({ items, total: items.length, page: 1, pageSize: 50 });
      },
    });
    renderApp('/agentes');
    const user = userEvent.setup();
    await screen.findByText('SRV-ARQUIVOS');
    expect(requested.at(-1)).toBe('hostname asc');
    expect(screen.getByRole('columnheader', { name: /Hostname/ })).toHaveAttribute('aria-sort', 'ascending');

    await user.click(screen.getByRole('button', { name: 'Ordenar por visto por último' }));
    await waitFor(() => expect(requested.at(-1)).toBe('lastSeen asc'));
    expect(screen.getByRole('columnheader', { name: /Visto por último/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: /Hostname/ })).toHaveAttribute('aria-sort', 'none');

    await user.click(screen.getByRole('button', { name: 'Ordenar por visto por último' }));
    await waitFor(() => expect(requested.at(-1)).toBe('lastSeen desc'));
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0] as HTMLElement).getByText('SRV-ARQUIVOS')).toBeInTheDocument();
  });

  it('abre com a ordenação do endereço', async () => {
    const requested: string[] = [];
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view'] })),
      'GET /api/clients': () => json(CLIENTS),
      'GET /api/agents': (_, url) => {
        requested.push(`${url.searchParams.get('sortBy') ?? ''} ${url.searchParams.get('sortDir') ?? ''}`);
        return json({ items: agents, total: agents.length, page: 1, pageSize: 50 });
      },
    });
    renderApp('/agentes?ordem=status&sentido=desc');
    await screen.findByText('SRV-ARQUIVOS');
    expect(requested.at(-1)).toBe('status desc');
    expect(screen.getByRole('columnheader', { name: /Status/ })).toHaveAttribute('aria-sort', 'descending');
  });

  it('mostra o responsável e busca pelo nome dele', async () => {
    const searched: string[] = [];
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view', 'inventory.view'] })),
      'GET /api/clients': () => json(CLIENTS),
      'GET /api/agents': (_, url) => {
        const search = url.searchParams.get('search') ?? '';
        searched.push(search);
        const withResponsible = [makeAgent({ responsible: { id: 4, name: 'Renata Prado' } }), ...agents.slice(1)];
        const items = search ? withResponsible.filter((a) => a.responsible?.name.toLowerCase().includes(search.toLowerCase())) : withResponsible;
        return json({ items, total: items.length, page: 1, pageSize: 50 });
      },
    });
    renderApp('/agentes');
    const user = userEvent.setup();

    expect(await screen.findByRole('link', { name: 'Renata Prado' })).toHaveAttribute('href', personPath(4));
    expect(screen.getByRole('columnheader', { name: /Responsável/ })).toBeInTheDocument();
    const other = screen.getByText('SRV-ARQUIVOS').closest('tr') as HTMLElement;
    expect(within(other).getByText('Sem responsável')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Buscar agentes' }), 'renata');
    await waitFor(() => expect(screen.queryByText('SRV-ARQUIVOS')).not.toBeInTheDocument());
    expect(searched.at(-1)).toBe('renata');
  });
});
