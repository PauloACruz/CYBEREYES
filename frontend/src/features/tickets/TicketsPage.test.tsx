import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateTicketRequest } from '../../api/types';
import { makeAgent, makeTicket, makeTicketDetail } from '../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

const tickets = [
  makeTicket(),
  makeTicket({
    id: 102,
    title: 'Servidor de arquivos lento',
    type: 'incident',
    status: 'in_progress',
    priority: 'critical',
    hostname: 'SRV-ARQUIVOS',
    agentId: 2,
    assignedToId: 'u1',
    assignedToName: 'Maria Silva',
    source: 'alert',
    slaBreached: true,
    unreadForTechnician: true,
  }),
];

const queues = [{ id: 1, name: 'Geral', description: null, isDefault: true, openCount: 2 }];

/** Abre o select e escolhe a opcao na lista ligada a ele (outras listas da pagina tem opcoes com o mesmo nome). */
async function choose(user: ReturnType<typeof userEvent.setup>, combobox: HTMLElement, option: string) {
  await user.click(combobox);
  await waitFor(() => expect(combobox.getAttribute('aria-controls')).toBeTruthy());
  const listbox = document.getElementById(combobox.getAttribute('aria-controls') ?? '') as HTMLElement;
  await user.click(await within(listbox).findByRole('option', { name: option, hidden: true }));
}

function listUrls(fetchMock: ReturnType<typeof mockFetch>): string[] {
  return fetchMock.mock.calls.map(([input]) => (typeof input === 'string' ? input : '')).filter((u) => u.startsWith('/api/tickets?'));
}

describe('lista de chamados', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra os chamados abertos por padrão e aplica os filtros', async () => {
    const fetchMock = mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['tickets.view'] })),
      'GET /api/tickets/summary': () => json({ open: 2, unassigned: 1, mine: 1, breached: 1, byStatus: {} }),
      'GET /api/ticket-queues': () => json(queues),
      'GET /api/tickets': (_, url) => {
        const priority = url.searchParams.get('priority');
        const items = priority ? tickets.filter((t) => t.priority === priority) : tickets;
        return json({ items, total: items.length, page: 1, pageSize: 50 });
      },
    });
    renderApp('/chamados');

    const row = (await screen.findByText('Servidor de arquivos lento')).closest('tr') as HTMLElement;
    const cells = within(row);
    expect(cells.getByText('#102')).toBeInTheDocument();
    expect(cells.getByText('Crítica')).toBeInTheDocument();
    expect(cells.getByText('Em atendimento')).toBeInTheDocument();
    expect(cells.getByText('Maria Silva')).toBeInTheDocument();
    expect(cells.getByRole('img', { name: 'SLA estourado' })).toBeInTheDocument();
    expect(cells.getByRole('img', { name: 'Mensagem não lida' })).toBeInTheDocument();
    const firstRow = screen.getByText('Impressora não imprime').closest('tr') as HTMLElement;
    expect(within(firstRow).getByText('Sem técnico')).toBeInTheDocument();
    expect(within(firstRow).getByText('Novo')).toBeInTheDocument();
    expect(screen.getByText('2 chamados')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Novo chamado' })).not.toBeInTheDocument();
    expect(await screen.findByLabelText('1 chamado sem técnico')).toBeInTheDocument();
    expect(listUrls(fetchMock).every((u) => u.includes('open=true'))).toBe(true);

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Filtrar por prioridade' }));
    await user.click(await screen.findByRole('option', { name: 'Crítica', hidden: true }));
    await waitFor(() => expect(screen.queryByText('Impressora não imprime')).not.toBeInTheDocument());

    await user.click(screen.getByRole('radio', { name: 'Sem técnico' }));
    await waitFor(() => expect(listUrls(fetchMock).some((u) => u.includes('assigned=unassigned') && u.includes('priority=critical'))).toBe(true));
  });

  it('cria um chamado pelo modal com máquina e técnico', async () => {
    let sent: CreateTicketRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['tickets.view', 'tickets.manage', 'agents.view'] })),
      'GET /api/tickets/summary': () => json({ open: 0, unassigned: 0, mine: 0, breached: 0, byStatus: {} }),
      'GET /api/ticket-queues': () => json(queues),
      'GET /api/tickets/assignees': () => json([{ id: 'u1', name: 'Maria Silva' }]),
      'GET /api/agents': () => json({ items: [makeAgent()], total: 1, page: 1, pageSize: 20 }),
      'GET /api/tickets': () => json({ items: [], total: 0, page: 1, pageSize: 50 }),
      'POST /api/tickets': (init) => {
        sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as CreateTicketRequest;
        return json(makeTicketDetail({ id: 150, title: sent.title }), 201);
      },
      'GET /api/tickets/150/messages': () => json([]),
      'GET /api/tickets/150/attachments': () => json([]),
      'GET /api/tickets/150/time': () => json([]),
    });
    const { router } = renderApp('/chamados');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Novo chamado' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo chamado' });
    const form = within(dialog);
    await user.type(form.getByRole('textbox', { name: 'Título' }), 'Sem rede');
    await user.type(form.getByRole('textbox', { name: 'Descrição' }), 'Cabo solto?');
    await choose(user, form.getByRole('combobox', { name: 'Prioridade' }), 'Alta');
    await choose(user, form.getByRole('combobox', { name: 'Máquina' }), 'PC-RECEPCAO');
    await choose(user, form.getByRole('combobox', { name: 'Técnico' }), 'Maria Silva');
    await user.click(form.getByRole('button', { name: 'Criar chamado' }));

    await waitFor(() =>
      expect(sent).toEqual({
        title: 'Sem rede',
        description: 'Cabo solto?',
        type: 'request',
        priority: 'high',
        agentId: 1,
        requesterName: 'maria',
        assignedToId: 'u1',
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/chamados/150'));
    expect(await screen.findByText('Chamado #150 criado.')).toBeInTheDocument();
  });
});
