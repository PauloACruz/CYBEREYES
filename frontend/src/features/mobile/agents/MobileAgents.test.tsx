import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandRequest, HealthReport } from '../../../api/types';
import { makeAgent, makeAgentDetail, makeTicket } from '../../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../../test/utils';

const ALL_PERMISSIONS = ['agents.view', 'agents.control', 'agents.remote', 'agents.files', 'agents.run', 'scripts.view', 'tickets.view', 'alerts.view'];

const agents = [
  makeAgent({ healthScore: 92, healthGrade: 'otimo' }),
  makeAgent({ id: 2, hostname: 'SRV-ARQUIVOS', status: 'offline', healthScore: null, healthGrade: null }),
];

const counts: Record<string, number> = { all: 3, online: 1, overdue: 1, offline: 1 };

function agentHandlers(posts: string[] = []) {
  return {
    'GET /api/auth/me': () => json(makeMe({ permissions: ALL_PERMISSIONS })),
    'GET /api/agents': (_: RequestInit | undefined, url: URL) => {
      const status = url.searchParams.get('status');
      if (url.searchParams.get('pageSize') === '1') return json({ items: [], total: counts[status ?? 'all'] ?? 0, page: 1, pageSize: 1 });
      const items = status ? agents.filter((a) => a.status === status) : agents;
      return json({ items, total: items.length, page: 1, pageSize: 30 });
    },
    'POST /api/agents/1/reboot': () => {
      posts.push('reboot');
      return json({});
    },
  };
}

describe('agentes no app', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra online frente ao total, filtra por status e reinicia pela folha de ações', async () => {
    const posts: string[] = [];
    const fetchMock = mockFetch(agentHandlers(posts));
    renderApp('/app/agentes');
    const user = userEvent.setup();

    const card = await screen.findByRole('link', { name: 'PC-RECEPCAO: Online' });
    expect(within(card).getByText('92')).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Estações online frente ao total' });
    await waitFor(() => expect(within(summary).getByText(/de 3/)).toBeInTheDocument());

    await user.click(screen.getByRole('radio', { name: /Offline/ }));
    await waitFor(() => expect(screen.queryByRole('link', { name: /PC-RECEPCAO/ })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: /SRV-ARQUIVOS/ })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => typeof input === 'string' && input.includes('status=offline') && input.includes('sortBy=status'))).toBe(true);

    await user.click(screen.getByRole('radio', { name: /Todos/ }));
    await user.click(await screen.findByRole('button', { name: 'Ações de PC-RECEPCAO' }));
    const menu = await screen.findByRole('menu', { name: 'Ações de PC-RECEPCAO' });
    expect(within(menu).getByRole('menuitem', { name: /Cybereyes Care/ })).toHaveAttribute('href', '/app/agentes/1/care');
    expect(within(menu).getByRole('menuitem', { name: /Enviar comando/ })).toHaveAttribute('href', '/app/agentes/1/comando');
    expect(within(menu).getByRole('menuitem', { name: /Executar script/ })).toHaveAttribute('href', '/agentes/1?aba=scripts');
    await user.click(within(menu).getByRole('menuitem', { name: /Reiniciar/ }));
    await user.click(await screen.findByRole('button', { name: 'Reiniciar' }));
    await waitFor(() => expect(posts).toEqual(['reboot']));
  });

  it('desativa as ações de controle de um agente offline', async () => {
    mockFetch(agentHandlers());
    renderApp('/app/agentes');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Ações de SRV-ARQUIVOS' }));
    const menu = await screen.findByRole('menu', { name: 'Ações de SRV-ARQUIVOS' });
    for (const label of [/Acesso remoto/, /Arquivos/, /Reiniciar/, /Desligar/]) {
      expect(within(menu).getByRole('menuitem', { name: label })).toBeDisabled();
    }
    expect(within(menu).getAllByText('agente offline').length).toBeGreaterThan(0);
    // O Care continua disponivel: a saude e o historico ficam no servidor.
    expect(within(menu).getByRole('menuitem', { name: /Cybereyes Care/ })).toHaveAttribute('href', '/app/agentes/2/care');
  });

  it('abre o agente com a nota de saúde, os chamados abertos e as informações', async () => {
    const report: HealthReport = { score: 82, grade: 'bom', collectedAt: '2026-10-01T09:00:00Z', platform: 'windows', items: [] };
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ALL_PERMISSIONS })),
      'GET /api/agents/1': () => json(makeAgentDetail()),
      'GET /api/agents/1/health': () => json(report),
      'GET /api/alerts': () => json({ items: [], total: 0, page: 1, pageSize: 5 }),
      'GET /api/agents/1/tickets': () => json([makeTicket(), makeTicket({ id: 103, title: 'Antigo', status: 'closed' })]),
    });
    renderApp('/app/agentes/1');

    expect(await screen.findByLabelText(/Nota 82 de 100/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar para Agentes' })).toHaveAttribute('href', '/app/agentes');
    expect(screen.getByRole('link', { name: /Ver saúde/ })).toHaveAttribute('href', '/app/agentes/1/care');
    expect(await screen.findByText('Chamados abertos (1)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Impressora não imprime/ })).toHaveAttribute('href', '/app/chamados/101');
    expect(screen.queryByText('Antigo')).not.toBeInTheDocument();
    expect(screen.getByText('Clínica Central / Matriz')).toBeInTheDocument();
    expect(screen.getByText('200.10.10.10')).toBeInTheDocument();
  });

  it('envia um comando rápido com confirmação e mostra a saída', async () => {
    let sent: CommandRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ALL_PERMISSIONS })),
      'GET /api/agents/1': () => json(makeAgentDetail()),
      'POST /api/agents/1/command': (init) => {
        sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as CommandRequest;
        return json({ historyId: 7, output: 'Status   Name\nRunning  Spooler' });
      },
    });
    renderApp('/app/agentes/1/comando');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Reiniciar o Spooler' }));
    expect(screen.getByRole('textbox', { name: 'Comando' })).toHaveValue('Restart-Service -Name Spooler -Force');
    await user.click(screen.getByRole('button', { name: 'Executar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Executar comando' });
    await user.click(within(dialog).getByRole('button', { name: 'Executar' }));

    await waitFor(() => expect(sent).toEqual({ shell: 'powershell', command: 'Restart-Service -Name Spooler -Force', timeout: 30, runAsUser: false }));
    expect(await screen.findByText(/Running Spooler/)).toBeInTheDocument();
  });
});
