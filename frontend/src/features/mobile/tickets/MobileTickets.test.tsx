import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateTicketMessageRequest } from '../../../api/types';
import { makeTicket, makeTicketDetail, makeTicketMessage } from '../../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../../test/utils';

const tickets = [
  makeTicket(),
  makeTicket({
    id: 102,
    title: 'Servidor de arquivos lento',
    priority: 'critical',
    status: 'in_progress',
    hostname: 'SRV-ARQUIVOS',
    assignedToId: 'u1',
    assignedToName: 'Maria Silva',
    slaBreached: true,
  }),
];

const summary = { open: 2, unassigned: 1, mine: 1, breached: 1, byStatus: {} };

describe('chamados no app', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lista os abertos e aplica os filtros rápidos', async () => {
    const assigned: (string | null)[] = [];
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['tickets.view', 'tickets.manage'] })),
      'GET /api/tickets/summary': () => json(summary),
      'GET /api/tickets': (_, url) => {
        expect(url.searchParams.get('open')).toBe('true');
        assigned.push(url.searchParams.get('assigned'));
        const filter = url.searchParams.get('assigned');
        const items = filter === 'unassigned' ? tickets.filter((t) => !t.assignedToId) : filter === 'me' ? tickets.filter((t) => t.assignedToId === 'u1') : tickets;
        return json({ items, total: items.length, page: 1, pageSize: 50 });
      },
    });
    renderApp('/app/chamados');
    const user = userEvent.setup();

    const card = await screen.findByRole('link', { name: 'Chamado #102: Servidor de arquivos lento' });
    expect(within(card).getByText('SLA estourado')).toBeInTheDocument();
    expect(within(card).getByText('Maria Silva')).toBeInTheDocument();
    const other = screen.getByRole('link', { name: 'Chamado #101: Impressora não imprime' });
    expect(within(other).getByText('Sem técnico')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Novo chamado' })).toHaveAttribute('href', '/app/chamados/novo');

    // SLA estourado: recorte feito no cliente sobre os abertos.
    await user.click(screen.getByRole('radio', { name: /SLA estourado/ }));
    await waitFor(() => expect(screen.queryByRole('link', { name: /Chamado #101/ })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: /Chamado #102/ })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Sem técnico/ }));
    await waitFor(() => expect(assigned).toContain('unassigned'));
    expect(await screen.findByRole('link', { name: /Chamado #101/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('link', { name: /Chamado #102/ })).not.toBeInTheDocument());
  });

  it('esconde o botão de novo chamado sem permissão de gerenciar', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['tickets.view'] })),
      'GET /api/tickets/summary': () => json(summary),
      'GET /api/tickets': () => json({ items: tickets, total: 2, page: 1, pageSize: 50 }),
    });
    renderApp('/app/chamados');

    expect(await screen.findByRole('link', { name: /Chamado #101/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Novo chamado' })).not.toBeInTheDocument();
  });

  it('abre o chamado, assume e responde ao usuário pela barra inferior', async () => {
    let sent: CreateTicketMessageRequest | undefined;
    let assignedTo: unknown;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['tickets.view', 'tickets.manage', 'agents.view'] })),
      'GET /api/tickets/summary': () => json(summary),
      'GET /api/tickets/101': () => json(makeTicketDetail()),
      'GET /api/tickets/101/messages': () => json([makeTicketMessage()]),
      'GET /api/tickets/101/attachments': () => json([]),
      'GET /api/tickets/101/time': () => json([]),
      'GET /api/tickets/assignees': () => json([{ id: 'u1', name: 'Maria Silva' }]),
      'GET /api/ticket-queues': () => json([{ id: 1, name: 'Geral', description: null, isDefault: true, openCount: 1 }]),
      'PUT /api/tickets/101/assign': (init) => {
        assignedTo = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
        return json(makeTicketDetail({ assignedToId: 'u1', assignedToName: 'Maria Silva' }));
      },
      'POST /api/tickets/101/messages': (init) => {
        sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as CreateTicketMessageRequest;
        return json(makeTicketMessage({ id: 2, authorType: 'technician', authorName: 'Maria Silva', body: sent.body }), 201);
      },
    });
    renderApp('/app/chamados/101');
    const user = userEvent.setup();

    expect(await screen.findByText('Impressora não imprime')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar para Chamados' })).toHaveAttribute('href', '/app/chamados');
    expect(screen.getByRole('link', { name: /Abrir máquina/ })).toHaveAttribute('href', '/app/agentes/1');
    const log = await screen.findByRole('log', { name: 'Mensagens do chamado' });
    expect(within(log).getByText('A impressora mostra erro de papel.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Assumir' }));
    await waitFor(() => expect(assignedTo).toEqual({ userId: 'u1' }));

    await user.type(screen.getByRole('textbox', { name: 'Resposta ao usuário' }), 'Já estou verificando.');
    await user.click(screen.getByRole('button', { name: 'Enviar resposta' }));
    await waitFor(() => expect(sent).toEqual({ body: 'Já estou verificando.', internal: false }));
    expect(await within(log).findByText('Já estou verificando.')).toBeInTheDocument();
  });
});
