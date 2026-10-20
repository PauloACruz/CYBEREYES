import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS, type ConsoleSessionDto } from '../../api/types';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

const WAITING: ConsoleSessionDto = {
  id: 's1',
  title: 'Reinicie o spooler da RECEPCAO-01',
  executor: 'native',
  executorName: 'Assistente Cybereyes',
  status: 'awaiting_approval',
  error: null,
  createdAt: '2026-10-19T12:00:00Z',
  updatedAt: '2026-10-19T12:00:05Z',
  entries: [
    { kind: 'request', text: 'Reinicie o spooler da RECEPCAO-01', at: '2026-10-19T12:00:00Z' },
    { kind: 'reply', text: 'Achei a máquina; vou reiniciar o serviço.', at: '2026-10-19T12:00:03Z' },
    { kind: 'action', text: null, at: '2026-10-19T12:00:03Z', tool: 'list_agents', input: '{"search":"RECEPCAO-01"}', result: '{"items":[]}', status: 'done' },
    { kind: 'action', text: null, at: '2026-10-19T12:00:04Z', tool: 'service_action', input: '{"agentId":7,"serviceName":"Spooler","action":"restart"}', status: 'pending' },
  ],
};

const DONE: ConsoleSessionDto = {
  ...WAITING,
  status: 'idle',
  entries: [
    ...(WAITING.entries ?? []).slice(0, 3),
    { kind: 'action', text: null, at: '2026-10-19T12:00:04Z', tool: 'service_action', input: '{"agentId":7,"serviceName":"Spooler","action":"restart"}', result: '{"status":"ok"}', status: 'done' },
    { kind: 'reply', text: 'Serviço Spooler reiniciado.', at: '2026-10-19T12:00:09Z' },
  ],
};

describe('menu Agente de IA', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('envia o pedido ao agente e só executa a ação que muda a máquina depois da aprovação', async () => {
    let started: unknown;
    let approval: unknown;
    let current = WAITING;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: [PERMISSIONS.assistantUse, PERMISSIONS.ticketsView] })),
      'GET /api/assistant/console/executors': () => json([{ id: 'native', name: 'Assistente Cybereyes', permissions: ['agents.control', 'agents.view'] }]),
      'GET /api/assistant/console/sessions': () => json(started ? [current] : []),
      'POST /api/assistant/console/sessions': (init) => {
        started = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
        return json(WAITING, 202);
      },
      'GET /api/assistant/console/sessions/s1': () => json(current),
      'POST /api/assistant/console/sessions/s1/approval': (init) => {
        approval = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
        current = DONE;
        return json(DONE, 202);
      },
    });
    renderApp('/agente-ia');

    expect(await screen.findByRole('link', { name: /Agente de IA/ })).toBeInTheDocument();
    const user = userEvent.setup();
    expect(await screen.findByText('Pode usar 2 permissões (as dele que você também tem).')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'O que o agente deve fazer' }), 'Reinicie o spooler da RECEPCAO-01');
    await user.click(screen.getByRole('button', { name: 'Enviar ao agente' }));
    await waitFor(() => expect(started).toEqual({ executor: 'native', message: 'Reinicie o spooler da RECEPCAO-01' }));

    const log = await screen.findByRole('log', { name: 'Conversa com o agente' });
    expect(within(log).getByText('service_action')).toBeInTheDocument();
    expect(within(log).getAllByText('Esperando aprovação')).toHaveLength(1);
    expect(screen.getByText(/O agente quer executar uma ação que muda máquinas: service_action/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Nova mensagem ao agente' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Aprovar e executar' }));
    await waitFor(() => expect(approval).toEqual({ approve: true }));
    expect(await screen.findByText('Serviço Spooler reiniciado.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar e executar' })).not.toBeInTheDocument();
  });

  it('avisa quando nenhum agente está ligado', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: [PERMISSIONS.assistantUse] })),
      'GET /api/assistant/console/executors': () => json([]),
      'GET /api/assistant/console/sessions': () => json([]),
    });
    renderApp('/agente-ia');

    expect(await screen.findByText('Nenhum agente disponível')).toBeInTheDocument();
  });
});
