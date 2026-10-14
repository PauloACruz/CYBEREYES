import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DashboardOverview } from '../../api/types';
import { CLIENTS } from '../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

function overview(days: number): DashboardOverview {
  const dates = Array.from({ length: days }, (_, i) => `2026-10-${String(13 - days + 1 + i).padStart(2, '0')}`);
  return {
    from: dates[0] ?? '2026-10-13',
    to: '2026-10-13',
    agents: {
      total: 24,
      online: 19,
      overdue: 2,
      offline: 3,
      byClient: [
        { clientId: 1, clientName: 'Clínica Central', total: 10, online: 9, overdue: 0, offline: 1 },
        { clientId: 2, clientName: 'Laboratório Vida', total: 14, online: 10, overdue: 2, offline: 2 },
      ],
    },
    tickets: { open: 8, unassigned: 2, breached: 1, openedInPeriod: 30, resolvedInPeriod: 27, days: dates.map((date) => ({ date, opened: 1, resolved: 1 })) },
    checks: { total: 1000, passing: 985, failing: 15, historyDays: 30, days: dates.map((date) => ({ date, passing: 10, failing: 1 })) },
  };
}

describe('painel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra estações online, chamados e checks e filtra pelo período', async () => {
    const requested: string[] = [];
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view', 'tickets.view', 'clients.view'] })),
      'GET /api/clients': () => json(CLIENTS),
      'GET /api/tickets/assignees': () => json([{ id: 'u-1', name: 'Maria Souza' }]),
      'GET /api/dashboard/overview': (_, url) => {
        requested.push(url.search);
        return json(overview(Number(url.searchParams.get('days') ?? 30)));
      },
    });
    renderApp('/');

    const online = await screen.findByRole('region', { name: 'Estações online frente ao total' });
    expect(within(online).getByText('de 24 online')).toBeInTheDocument();
    expect(within(online).getByText('Laboratório Vida')).toBeInTheDocument();
    const tickets = screen.getByRole('region', { name: 'Chamados' });
    expect(within(tickets).getByText('Sem técnico')).toBeInTheDocument();
    expect(within(tickets).getByText('Abertos e resolvidos por dia')).toBeInTheDocument();
    const checks = screen.getByRole('region', { name: 'Checks realizados por período' });
    expect(within(checks).getByText('98,5%')).toBeInTheDocument();
    expect(screen.getByText('últimos 30 dias')).toBeInTheDocument();
    expect(requested[0]).toContain('days=30');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Filtros' }));
    await user.click(await screen.findByRole('radio', { name: '7 dias', hidden: true }));
    await waitFor(() => expect(requested.at(-1)).toContain('days=7'));
    expect(await screen.findByText('últimos 7 dias')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filtros (1 ativos)' })).toBeInTheDocument();
  });

  it('mostra os procedimentos nos agentes com os sem chamado em destaque', async () => {
    const data = overview(7);
    data.procedures = {
      total: 42,
      seconds: 5400,
      inTickets: 30,
      unlinked: 12,
      days: data.tickets!.days.map((d) => ({ date: d.date, count: 6, seconds: 600 })),
      byKind: [
        { kind: 'remote', count: 20, seconds: 4200 },
        { kind: 'care', count: 12, seconds: 900 },
      ],
      byUser: [{ userId: 'u-1', userName: 'Maria Souza', count: 42, seconds: 5400 }],
    };
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view', 'tickets.view'] })),
      'GET /api/tickets/assignees': () => json([{ id: 'u-1', name: 'Maria Souza' }]),
      'GET /api/dashboard/overview': () => json(data),
    });
    renderApp('/');

    const card = await screen.findByRole('region', { name: 'Procedimentos nos agentes' });
    expect(within(card).getByText('1 h 30 min')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Sem chamado: 12' })).toHaveAttribute('href', '/procedimentos?chamado=sem-chamado');
    const byKind = within(card).getByRole('region', { name: 'Procedimentos por tipo' });
    expect(within(byKind).getByText('Acesso remoto')).toBeInTheDocument();
    expect(within(byKind).getByText('20 · 1 h 10 min')).toBeInTheDocument();
    expect(within(within(card).getByRole('region', { name: 'Procedimentos por técnico' })).getByText('Maria Souza')).toBeInTheDocument();
  });
});
