import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncludeProceduresRequest, ProcedureDto, ProcedurePage, ProceduresTicketRequest } from '../../api/types';
import { CLIENTS, makeTicket, makeTicketDetail } from '../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

function makeProcedure(overrides: Partial<ProcedureDto> = {}): ProcedureDto {
  return {
    id: 1,
    agentId: 1,
    hostname: 'PC-RECEPCAO',
    clientId: 1,
    clientName: 'Clínica Central',
    kind: 'remote',
    title: 'Tela',
    detail: null,
    status: 'ok',
    source: 'console',
    userId: 'u1',
    userName: 'Maria Silva',
    startedAt: '2026-10-13T14:00:00Z',
    finishedAt: '2026-10-13T14:12:30Z',
    durationSeconds: 750,
    ticketId: null,
    ticketTitle: null,
    timeEntryId: null,
    serviceMinutes: null,
    ...overrides,
  };
}

const procedures = [
  makeProcedure(),
  makeProcedure({ id: 2, kind: 'care', title: 'Manutenção do sistema (3 tarefas)', detail: 'temp_files, dns_flush, sfc', durationSeconds: 300 }),
  makeProcedure({ id: 3, kind: 'command', title: 'ipconfig /all', detail: 'cmd', ticketId: 101, ticketTitle: 'Impressora não imprime', timeEntryId: 9, serviceMinutes: 5 }),
  makeProcedure({ id: 4, kind: 'terminal', title: 'powershell', status: 'running', finishedAt: null, durationSeconds: null }),
];

function page(items: ProcedureDto[]): ProcedurePage {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 50,
    totals: { count: items.length, seconds: 1050, inTickets: 1, serviceMinutes: 5, unlinked: items.length - 1 },
  };
}

const ALL = ['agents.view', 'tickets.view', 'tickets.manage', 'clients.view'];

describe('procedimentos', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lista com totais, filtra e inclui os selecionados num chamado aberto', async () => {
    const queries: URLSearchParams[] = [];
    let included: IncludeProceduresRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ALL })),
      'GET /api/clients': () => json(CLIENTS),
      'GET /api/tickets/assignees': () => json([{ id: 'u1', name: 'Maria Silva' }]),
      'GET /api/procedures': (_, url) => {
        queries.push(url.searchParams);
        const linked = url.searchParams.get('linked');
        return json(page(linked === 'false' ? procedures.filter((p) => p.ticketId === null) : procedures));
      },
      'GET /api/tickets': () => json({ items: [makeTicket()], total: 1, page: 1, pageSize: 30 }),
      'POST /api/tickets/101/procedures': (init) => {
        included = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as IncludeProceduresRequest;
        return json([]);
      },
    });
    renderApp('/procedimentos');
    const user = userEvent.setup();

    expect(await screen.findByText('Manutenção do sistema (3 tarefas)')).toBeInTheDocument();
    const row = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;
    expect(within(row('Tela')).getByText('12 min')).toBeInTheDocument();
    expect(within(row('powershell')).getByText('Em andamento')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /#101 Impressora não imprime/ })).toHaveAttribute('href', '/chamados/101');
    expect(screen.getByText('17 min')).toBeInTheDocument();
    expect(screen.getByText('5 min de serviço apontado')).toBeInTheDocument();

    // Ja em chamado e em andamento nao podem ser marcados.
    expect(within(row('ipconfig /all')).getByRole('checkbox')).toBeDisabled();
    expect(within(row('powershell')).getByRole('checkbox')).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: 'Sem chamado' }));
    await waitFor(() => expect(queries.at(-1)?.get('linked')).toBe('false'));

    await user.click(within(row('Tela')).getByRole('checkbox'));
    await user.click(within(row('Manutenção do sistema (3 tarefas)')).getByRole('checkbox'));
    expect(screen.getByText('2 procedimentos selecionados')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Incluir em chamado' }));

    const dialog = await screen.findByRole('dialog', { name: 'Incluir em chamado' });
    await user.click(within(dialog).getByRole('combobox', { name: /Chamado aberto/ }));
    await user.click(await screen.findByRole('option', { name: /#101 Impressora não imprime/, hidden: true }));
    const minutes = within(dialog).getByRole('textbox', { name: 'Minutos de serviço: Acesso remoto: Tela' });
    expect(minutes).toHaveValue('13 min');
    await user.clear(minutes);
    await user.type(minutes, '20');
    await user.click(within(dialog).getByRole('button', { name: 'Incluir' }));

    await waitFor(() =>
      expect(included).toEqual({
        items: [
          { procedureId: 1, minutes: 20 },
          { procedureId: 2, minutes: 5 },
        ],
      }),
    );
  });

  it('registra um chamado resolvido a partir de um acesso remoto sem chamado', async () => {
    let sent: ProceduresTicketRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ALL })),
      'GET /api/clients': () => json(CLIENTS),
      'GET /api/tickets/assignees': () => json([]),
      'GET /api/procedures': () => json(page([procedures[0]!])),
      'POST /api/procedures/ticket': (init) => {
        sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as ProceduresTicketRequest;
        return json({ id: 120 }, 201);
      },
      'GET /api/tickets/120': () => json(makeTicketDetail({ id: 120, title: 'Atendimento em PC-RECEPCAO', status: 'resolved' })),
      'GET /api/tickets/120/messages': () => json([]),
      'GET /api/tickets/120/attachments': () => json([]),
      'GET /api/tickets/120/time': () => json([]),
      'GET /api/tickets/120/procedures': () => json([]),
      'GET /api/ticket-queues': () => json([]),
      'GET /api/tickets/summary': () => json({ open: 0, unassigned: 0, mine: 0, breached: 0, byStatus: {} }),
    });
    const { router } = renderApp('/procedimentos');
    const user = userEvent.setup();

    const row = (await screen.findByText('Tela')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Registrar como chamado' }));
    const dialog = await screen.findByRole('dialog', { name: 'Registrar como chamado' });
    expect(within(dialog).getByRole('textbox', { name: 'Título' })).toHaveValue('Atendimento em PC-RECEPCAO');
    expect(within(dialog).getByRole('checkbox', { name: 'Já marcar como resolvido' })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Registrar chamado' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/chamados/120'));
    expect(sent).toMatchObject({ procedureIds: [1], title: 'Atendimento em PC-RECEPCAO', resolve: true, priority: 'low' });
    expect(sent?.description).toContain('Acesso remoto: Tela em PC-RECEPCAO (12 min)');
  });

  it('mostra no chamado os procedimentos incluídos e remove com confirmação', async () => {
    let removed = false;
    let included: IncludeProceduresRequest | undefined;
    const linked = makeProcedure({ id: 7, ticketId: 101, ticketTitle: 'Impressora não imprime', timeEntryId: 3, serviceMinutes: 13 });
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ALL })),
      'GET /api/tickets/summary': () => json({ open: 1, unassigned: 1, mine: 0, breached: 0, byStatus: {} }),
      'GET /api/tickets/101': () => json(makeTicketDetail({ totalMinutes: 13 })),
      'GET /api/tickets/101/messages': () => json([]),
      'GET /api/tickets/101/attachments': () => json([]),
      'GET /api/tickets/101/time': () =>
        json(removed ? [] : [{ id: 3, userId: 'u1', userName: 'Maria Silva', minutes: 13, description: 'Acesso remoto em PC-RECEPCAO: Tela', workDate: '2026-10-13', createdAt: '2026-10-13T14:13:00Z', procedureId: 7 }]),
      'GET /api/tickets/101/procedures': () => json(removed ? [] : [linked]),
      'DELETE /api/tickets/101/procedures/7': () => {
        removed = true;
        return new Response(null, { status: 204 });
      },
      'GET /api/procedures': () => json(page([makeProcedure({ id: 8, kind: 'reboot', title: '' })])),
      'POST /api/tickets/101/procedures': (init) => {
        included = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as IncludeProceduresRequest;
        return json([]);
      },
      'GET /api/tickets/assignees': () => json([{ id: 'u1', name: 'Maria Silva' }]),
      'GET /api/ticket-queues': () => json([{ id: 1, name: 'Geral', description: null, isDefault: true, openCount: 1 }]),
    });
    renderApp('/chamados/101');
    const user = userEvent.setup();

    const panel = await screen.findByRole('region', { name: 'Procedimentos' });
    expect(await within(panel).findByText('Tela')).toBeInTheDocument();
    expect(within(panel).getAllByText('13 min').length).toBeGreaterThan(0);
    expect(screen.getByTitle('Veio de um procedimento no agente')).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Incluir procedimentos' }));
    const picker = await screen.findByRole('dialog', { name: 'Incluir procedimentos no chamado' });
    await user.click(await within(picker).findByRole('checkbox', { name: 'Reinício' }));
    await user.click(within(picker).getByRole('button', { name: 'Incluir' }));
    await waitFor(() => expect(included).toEqual({ items: [{ procedureId: 8, minutes: 13 }] }));

    await user.click(within(panel).getByRole('button', { name: 'Remover acesso remoto do chamado' }));
    await user.click(await screen.findByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(removed).toBe(true));
    expect(await within(panel).findByText(/Nenhum procedimento incluído/)).toBeInTheDocument();
  });
});
