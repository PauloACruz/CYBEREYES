import { HubConnectionBuilder } from '@microsoft/signalr';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CreateTicketMessageRequest, ResolveTicketRequest, TicketMessageDto } from '../../api/types';
import { makeTicketDetail, makeTicketMessage } from '../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

const messages = [
  makeTicketMessage(),
  makeTicketMessage({ id: 2, authorType: 'technician', authorName: 'Maria Silva', body: 'Vou verificar.', createdAt: '2026-10-01T10:10:00Z' }),
  makeTicketMessage({ id: 3, authorType: 'technician', authorName: 'Maria Silva', body: 'Toner vazio no estoque.', internal: true }),
];

function ticketHandlers(extra: Parameters<typeof mockFetch>[0] = {}) {
  return {
    'GET /api/auth/me': () => json(makeMe({ permissions: ['tickets.view', 'tickets.manage'] })),
    'GET /api/tickets/summary': () => json({ open: 1, unassigned: 1, mine: 0, breached: 0, byStatus: {} }),
    'GET /api/tickets/101': () => json(makeTicketDetail()),
    'GET /api/tickets/101/messages': () => json(messages),
    'GET /api/tickets/101/attachments': () => json([]),
    'GET /api/tickets/101/time': () => json([]),
    'GET /api/tickets/assignees': () => json([{ id: 'u1', name: 'Maria Silva' }]),
    'GET /api/ticket-queues': () => json([{ id: 1, name: 'Geral', description: null, isDefault: true, openCount: 1 }]),
    ...extra,
  };
}

describe('detalhe do chamado', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra a nota interna destacada e envia uma nova nota interna', async () => {
    let sent: CreateTicketMessageRequest | undefined;
    mockFetch(
      ticketHandlers({
        'POST /api/tickets/101/messages': (init) => {
          sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as CreateTicketMessageRequest;
          return json(makeTicketMessage({ id: 4, authorType: 'technician', authorName: 'Maria Silva', body: sent.body, internal: sent.internal }), 201);
        },
      }),
    );
    renderApp('/chamados/101');

    const log = await screen.findByRole('log', { name: 'Mensagens do chamado' });
    const note = within(log).getByRole('article', { name: 'Nota interna de Maria Silva' });
    expect(within(note).getByText('Nota interna')).toBeInTheDocument();
    expect(within(note).getByText('Toner vazio no estoque.')).toBeInTheDocument();
    expect(within(log).getByRole('article', { name: 'Mensagem de maria' })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Nota interna' }));
    await user.type(screen.getByRole('textbox', { name: 'Nota interna' }), 'Toner pedido.');
    await user.click(screen.getByRole('button', { name: 'Salvar nota' }));

    await waitFor(() => expect(sent).toEqual({ body: 'Toner pedido.', internal: true }));
    const newNote = await within(log).findByText('Toner pedido.');
    expect(within(newNote.closest('article') as HTMLElement).getByText('Nota interna')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Nota interna' })).toHaveValue('');
  });

  it('incidente interno só aceita nota interna, na conversa e na solução', async () => {
    let sent: CreateTicketMessageRequest | undefined;
    mockFetch(
      ticketHandlers({
        'GET /api/tickets/101': () => json(makeTicketDetail({ type: 'incident', requesterName: 'Análise da IA', requesterUsername: null })),
        'POST /api/tickets/101/messages': (init) => {
          sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as CreateTicketMessageRequest;
          return json(makeTicketMessage({ id: 4, authorType: 'technician', authorName: 'Maria Silva', body: sent.body, internal: sent.internal }), 201);
        },
      }),
    );
    renderApp('/chamados/101');

    expect(await screen.findByText('Incidente interno: as mensagens ficam como notas, só para os técnicos.')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Resposta ao usuário' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Nota interna' }), 'Driver atualizado.');
    await user.click(screen.getByRole('button', { name: 'Salvar nota' }));
    await waitFor(() => expect(sent).toEqual({ body: 'Driver atualizado.', internal: true }));

    await user.click(screen.getByRole('button', { name: 'Resolver' }));
    const dialog = await screen.findByRole('dialog', { name: 'Resolver chamado #101' });
    expect(within(dialog).queryByRole('checkbox', { name: 'Enviar ao usuário na conversa' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('Incidente interno: o texto fica como nota, só para os técnicos.')).toBeInTheDocument();
  });

  it('resolve com uma solução de contorno e mostra o texto no chamado', async () => {
    let sent: ResolveTicketRequest | undefined;
    mockFetch(
      ticketHandlers({
        'POST /api/tickets/101/resolve': (init) => {
          sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as ResolveTicketRequest;
          return json(
            makeTicketDetail({
              status: 'resolved',
              resolvedAt: '2026-10-01T11:00:00Z',
              resolutionKind: sent.kind,
              resolution: sent.resolution,
              resolvedByName: 'Maria Silva',
            }),
          );
        },
      }),
    );
    renderApp('/chamados/101');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Resolver' }));
    const dialog = await screen.findByRole('dialog', { name: 'Resolver chamado #101' });
    const submit = within(dialog).getByRole('button', { name: 'Resolver' });
    expect(submit).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: 'Solução de contorno' }));
    await user.type(within(dialog).getByRole('textbox', { name: /Solução de contorno/ }), '  Usar a impressora do 2º andar.  ');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Enviar ao usuário na conversa' }));
    await user.click(submit);

    await waitFor(() => expect(sent).toEqual({ kind: 'workaround', resolution: 'Usar a impressora do 2º andar.', internal: true }));
    const card = await screen.findByRole('region', { name: 'Solução de contorno' });
    expect(within(card).getByText('Usar a impressora do 2º andar.')).toBeInTheDocument();
    expect(within(card).getByText(/Por Maria Silva em/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolver' })).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Editar solução' })).toBeInTheDocument();
  });

  it('acrescenta mensagens recebidas pelo hub sem duplicar', async () => {
    mockFetch(ticketHandlers());
    // O setup dos testes substitui a conexao por um objeto unico com vi.fn().
    const hub = new HubConnectionBuilder().build() as unknown as { invoke: Mock; on: Mock };
    renderApp('/chamados/101');

    const log = await screen.findByRole('log', { name: 'Mensagens do chamado' });
    await waitFor(() => expect(hub.invoke).toHaveBeenCalledWith('JoinTicket', 101));
    const handlers = hub.on.mock.calls.filter(([event]) => event === 'ticketMessage');
    const onMessage = handlers[handlers.length - 1]?.[1] as (ticketId: number, message: TicketMessageDto) => void;

    const incoming = makeTicketMessage({ id: 10, body: 'Já troquei o papel e continua.' });
    act(() => {
      onMessage(101, incoming);
      onMessage(101, incoming);
      onMessage(101, makeTicketMessage({ id: 1 }));
      onMessage(999, makeTicketMessage({ id: 11, ticketId: 999, body: 'Outro chamado' }));
    });

    expect(await within(log).findByText('Já troquei o papel e continua.')).toBeInTheDocument();
    expect(within(log).getAllByText('Já troquei o papel e continua.')).toHaveLength(1);
    expect(within(log).getAllByText('A impressora mostra erro de papel.')).toHaveLength(1);
    expect(within(log).queryByText('Outro chamado')).not.toBeInTheDocument();
    expect(within(log).getAllByRole('article')).toHaveLength(4);
  });
});
