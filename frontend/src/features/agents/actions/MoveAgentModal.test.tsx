import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientDto } from '../../../api/types';
import { makeAgent, makeAgentDetail } from '../../../test/fixtures';
import { json, makeMe, mockFetch, problem, renderApp } from '../../../test/utils';

const clients: ClientDto[] = [
  { id: 1, name: 'Clínica Central', agentCount: 2, sites: [{ id: 10, clientId: 1, name: 'Matriz', agentCount: 2 }] },
  {
    id: 2,
    name: 'Escritório Andrade',
    agentCount: 0,
    sites: [
      { id: 20, clientId: 2, name: 'Sede', agentCount: 0 },
      { id: 21, clientId: 2, name: 'Filial', agentCount: 0 },
    ],
  },
];

const manager = makeMe({ permissions: ['agents.view', 'agents.manage', 'clients.view'] });

describe('mudar o agente de cliente ou site', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pelo lápis do agente, escolhe o site de outro cliente e move', async () => {
    let sent: unknown;
    mockFetch({
      'GET /api/auth/me': () => json(manager),
      'GET /api/agents/1': () => json(makeAgentDetail()),
      'GET /api/clients': () => json(clients),
      'PUT /api/agents/1/site': (init) => {
        sent = JSON.parse(init?.body as string);
        return json({ clientId: 2, clientName: 'Escritório Andrade', siteId: 21, siteName: 'Filial', movedTickets: 2, clientChanged: true });
      },
    });
    renderApp('/agentes/1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Mudar cliente ou site' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mudar cliente ou site' });
    expect(within(dialog).getByText(/está em Clínica Central \/ Matriz/)).toBeInTheDocument();
    const move = within(dialog).getByRole('button', { name: 'Mover' });
    expect(move).toBeDisabled();

    await user.click(within(dialog).getByRole('combobox', { name: 'Novo cliente / site' }));
    await user.click(await screen.findByRole('option', { name: 'Escritório Andrade / Filial', hidden: true }));
    expect(within(dialog).getByText(/o responsável pelo ativo .* é desvinculado/)).toBeInTheDocument();
    await user.click(move);

    await waitFor(() => expect(sent).toEqual({ siteId: 21 }));
    expect(await screen.findByText('PC-RECEPCAO agora está em Escritório Andrade / Filial. 2 chamados abertos foram junto.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Mudar cliente ou site' })).not.toBeInTheDocument());
  });

  it('mostra a recusa do servidor (coletor SNMP do cliente atual)', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(manager),
      'GET /api/agents/1': () => json(makeAgentDetail()),
      'GET /api/clients': () => json(clients),
      'PUT /api/agents/1/site': () =>
        problem(409, 'CONFLICT', 'O agente coleta 1 dispositivo(s) SNMP do cliente Clínica Central: escolha outro coletor para eles antes de mudar de cliente'),
    });
    renderApp('/agentes/1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Mudar cliente ou site' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mudar cliente ou site' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Novo cliente / site' }));
    await user.click(await screen.findByRole('option', { name: 'Escritório Andrade / Sede', hidden: true }));
    await user.click(within(dialog).getByRole('button', { name: 'Mover' }));

    expect(await screen.findByText(/escolha outro coletor para eles antes de mudar de cliente/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Mudar cliente ou site' })).toBeInTheDocument();
  });

  it('pelo botão direito na lista de agentes', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(manager),
      'GET /api/agents': () => json({ items: [makeAgent()], total: 1, page: 1, pageSize: 50 }),
      'GET /api/clients': () => json(clients),
    });
    renderApp('/agentes');

    const row = (await screen.findByText('PC-RECEPCAO')).closest('tr') as HTMLElement;
    fireEvent.contextMenu(row, { clientX: 200, clientY: 120 });
    const menu = await screen.findByRole('menu', { name: 'Ações de PC-RECEPCAO', hidden: true });
    await userEvent.setup().click(within(menu).getByRole('menuitem', { name: 'Mudar cliente ou site', hidden: true }));
    expect(await screen.findByRole('dialog', { name: 'Mudar cliente ou site' })).toBeInTheDocument();
  });

  it('sem agents.manage, não aparece', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view', 'agents.control'] })),
      'GET /api/agents/1': () => json(makeAgentDetail()),
    });
    renderApp('/agentes/1');

    expect(await screen.findByRole('button', { name: 'Ações' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mudar cliente ou site' })).not.toBeInTheDocument();
  });
});
