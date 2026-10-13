import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
    // O sistema aparece so como icone; o nome completo fica no rotulo acessivel.
    expect(cells.getByRole('img', { name: 'Ubuntu 24.04 LTS' })).toBeInTheDocument();
    expect(cells.queryByText('Servidor')).not.toBeInTheDocument();
    expect(cells.getByText('root')).toBeInTheDocument();
    expect(cells.getByText('Pendente')).toBeInTheDocument();
    const firstRow = screen.getByText('PC-RECEPCAO').closest('tr') as HTMLElement;
    expect(within(firstRow).getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('2 agentes')).toBeInTheDocument();
    // A busca fica recolhida num icone ate o clique.
    expect(screen.queryByRole('textbox', { name: 'Buscar agentes' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir a busca' })).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: 'Abrir a busca' }));
    await user.type(screen.getByRole('textbox', { name: 'Buscar agentes' }), 'renata');
    await waitFor(() => expect(screen.queryByText('SRV-ARQUIVOS')).not.toBeInTheDocument());
    expect(searched.at(-1)).toBe('renata');
  });

  it('mostra a nota de saúde e abre o menu de ações com o botão direito', async () => {
    const posts: string[] = [];
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view', 'agents.control', 'agents.remote', 'agents.files', 'agents.run', 'scripts.view'] })),
      'GET /api/clients': () => json(CLIENTS),
      'GET /api/agents': () =>
        json({ items: [makeAgent({ plat: 'windows', healthScore: 92, healthGrade: 'otimo' }), { ...agents[1], status: 'offline' }], total: 2, page: 1, pageSize: 50 }),
      'POST /api/agents/1/reboot': () => {
        posts.push('reboot');
        return json({});
      },
    });
    renderApp('/agentes');
    const user = userEvent.setup();

    const row = (await screen.findByText('PC-RECEPCAO')).closest('tr') as HTMLElement;
    expect(within(row).getByText('92')).toBeInTheDocument();
    expect(within(row).getByText('Ótimo')).toBeInTheDocument();
    const offline = screen.getByText('SRV-ARQUIVOS').closest('tr') as HTMLElement;
    expect(within(offline).getByText('Sem nota')).toBeInTheDocument();

    fireEvent.contextMenu(row, { clientX: 200, clientY: 120 });
    const menu = await screen.findByRole('menu', { name: 'Ações de PC-RECEPCAO', hidden: true });
    for (const label of ['Alterar hostname', 'Acesso remoto', 'Arquivos', 'Enviar comando', 'Executar script', 'Reiniciar', 'Desligar']) {
      expect(within(menu).getByRole('menuitem', { name: label, hidden: true })).toBeEnabled();
    }
    await user.click(within(menu).getByRole('menuitem', { name: 'Reiniciar', hidden: true }));
    await user.click(await screen.findByRole('button', { name: 'Reiniciar' }));
    await waitFor(() => expect(posts).toEqual(['reboot']));

    // Desligar abre a confirmacao pelo nome da maquina.
    fireEvent.contextMenu(row, { clientX: 200, clientY: 120 });
    const again = await screen.findByRole('menu', { name: 'Ações de PC-RECEPCAO', hidden: true });
    await user.click(within(again).getByRole('menuitem', { name: 'Desligar', hidden: true }));
    const shutdown = await screen.findByRole('dialog', { name: 'Desligar máquina' });
    await user.click(within(shutdown).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Desligar máquina' })).not.toBeInTheDocument());

    // Agente offline: as acoes aparecem desativadas, com o aviso.
    fireEvent.contextMenu(screen.getByText('SRV-ARQUIVOS').closest('tr') as HTMLElement, { clientX: 200, clientY: 180 });
    const offlineMenu = await screen.findByRole('menu', { name: 'Ações de SRV-ARQUIVOS', hidden: true });
    expect(within(offlineMenu).getByText(/Agente offline/)).toBeInTheDocument();
    expect(within(offlineMenu).getByRole('menuitem', { name: 'Acesso remoto', hidden: true })).toBeDisabled();
    // Linux nao tem a opcao de renomear.
    expect(within(offlineMenu).queryByRole('menuitem', { name: 'Alterar hostname', hidden: true })).not.toBeInTheDocument();
  });
});
