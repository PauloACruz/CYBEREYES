import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateTicketRequest, LogInsightDetailDto, LogInsightSummaryDto } from '../../../api/types';
import { makeTicketDetail } from '../../../test/fixtures';
import { json, makeMe, mockFetch, problem, renderApp } from '../../../test/utils';
import { trendLabel } from './insightFormat';

const SUMMARY: LogInsightSummaryDto = {
  id: 3,
  createdAt: '2026-10-19T12:00:00Z',
  windowStart: '2026-10-18T12:00:00Z',
  windowEnd: '2026-10-19T12:00:00Z',
  status: 'ok',
  manual: false,
  model: 'claude-opus-5-5',
  summary: 'O spooler de impressão falha todos os dias em 4 máquinas.',
  eventCount: 40,
  groupCount: 1,
  agentCount: 4,
  error: null,
};

const DETAIL: LogInsightDetailDto = {
  ...SUMMARY,
  inputTokens: 1000,
  outputTokens: 300,
  items: [
    {
      group: 'G1',
      level: 'error',
      source: 'Service Control Manager',
      eventId: 7031,
      sample: 'O serviço Spooler terminou inesperadamente.',
      count: 40,
      previousCount: 20,
      agents: 4,
      days: 6,
      firstSeen: '2026-10-13T08:00:00Z',
      lastSeen: '2026-10-19T11:00:00Z',
      hosts: ['PC-RECEPCAO', 'PC-CAIXA'],
      machines: [
        { agentId: 12, hostname: 'PC-RECEPCAO', client: 'Padaria Central', site: 'Matriz' },
        { agentId: null, hostname: 'PC-CAIXA', client: 'Padaria Central', site: 'Loja 2' },
      ],
      title: 'Spooler de impressão parando',
      severity: 'alta',
      officialDescription: 'O Service Control Manager registra o evento 7031 quando um serviço termina de forma inesperada.',
      reference: 'Microsoft Learn: Event ID 7031',
      probableCause: 'Driver de impressora com defeito.',
      resolution: ['Atualize o driver da impressora', 'Limpe a fila de impressão'],
      platformActions: ['Crie uma regra de alerta de log para o evento 7031'],
    },
  ],
  suggestions: [{ title: 'Entrada no FAQ', detail: 'Cadastre o passo a passo de limpar a fila com a tag orientar.' }],
};

describe('análises da IA na tela de logs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra a recorrência, a descrição oficial, a resolução e as sugestões, e pede uma análise nova', async () => {
    let ran = false;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['logs.view', 'settings.manage'] })),
      'GET /api/assistant/insights': () => json({ configured: true, enabled: true, intervalHours: 24, running: false, reports: [SUMMARY] }),
      'GET /api/assistant/insights/3': () => json(DETAIL),
      'POST /api/assistant/insights/run': () => {
        ran = true;
        return new Response(null, { status: 202 });
      },
    });
    renderApp('/logs?aba=analises');

    expect(await screen.findByText('Spooler de impressão parando')).toBeInTheDocument();
    expect(screen.getByText('40 ocorrências · 4 máquinas')).toBeInTheDocument();
    expect(screen.getByText('6 de 7 dias')).toBeInTheDocument();
    expect(screen.getByText(/\+100% em relação ao período anterior/)).toBeInTheDocument();
    expect(screen.getByText('Fonte: Microsoft Learn: Event ID 7031')).toBeInTheDocument();
    expect(screen.getByText('Limpe a fila de impressão')).toBeInTheDocument();
    expect(screen.getByText('Crie uma regra de alerta de log para o evento 7031')).toBeInTheDocument();
    expect(screen.getByText('Entrada no FAQ')).toBeInTheDocument();

    // Cada máquina com o cliente e o site; sem tickets.manage não há botão de incidente.
    const machines = screen.getByRole('table', { name: 'Máquinas com o erro Spooler de impressão parando' });
    const recepcao = within(machines).getByRole('row', { name: /PC-RECEPCAO/ });
    expect(within(recepcao).getByText('Padaria Central')).toBeInTheDocument();
    expect(within(recepcao).getByText('Matriz')).toBeInTheDocument();
    expect(within(machines).getByRole('link', { name: 'PC-RECEPCAO' })).toHaveAttribute('href', '/agentes/12');
    expect(within(machines).getByRole('row', { name: /PC-CAIXA/ })).toHaveTextContent('Loja 2');
    expect(screen.getByText('E mais 2 máquinas com o erro.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Abrir incidente/ })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Analisar agora' }));
    await waitFor(() => expect(ran).toBe(true));
    expect(await screen.findByText('Análise iniciada. Leva alguns minutos.')).toBeInTheDocument();
  });

  it('abre um incidente interno na máquina com a análise na descrição', async () => {
    let sent: CreateTicketRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['logs.view', 'tickets.manage'] })),
      'GET /api/assistant/insights': () => json({ configured: true, enabled: true, intervalHours: 24, running: false, reports: [SUMMARY] }),
      'GET /api/assistant/insights/3': () => json(DETAIL),
      'GET /api/ticket-queues': () => json([{ id: 1, name: 'Suporte', description: null, isDefault: true }]),
      'GET /api/tickets/assignees': () => json([]),
      'POST /api/tickets': (init) => {
        sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as CreateTicketRequest;
        return json(makeTicketDetail({ id: 77, title: sent.title, type: 'incident' }), 201);
      },
    });
    renderApp('/logs?aba=analises');

    const user = userEvent.setup();
    const machines = await screen.findByRole('table', { name: 'Máquinas com o erro Spooler de impressão parando' });
    // A máquina que não existe mais não recebe incidente.
    expect(within(within(machines).getByRole('row', { name: /PC-CAIXA/ })).queryByRole('button')).not.toBeInTheDocument();
    await user.click(within(machines).getByRole('button', { name: 'Abrir incidente em PC-RECEPCAO' }));

    const dialog = await screen.findByRole('dialog', { name: 'Abrir incidente' });
    expect(within(dialog).getByText(/não aparece para o usuário da máquina/)).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /Título/ })).toHaveValue('[PC-RECEPCAO] Spooler de impressão parando');
    expect(within(dialog).getByRole('combobox', { name: 'Prioridade' })).toHaveValue('Alta');
    await user.click(within(dialog).getByRole('button', { name: 'Abrir incidente' }));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent).toMatchObject({ type: 'incident', agentId: 12, priority: 'high', requesterName: 'Análise da IA' });
    expect(sent?.description).toContain('Máquina: PC-RECEPCAO (Padaria Central / Matriz)');
    expect(sent?.description).toContain('1. Atualize o driver da impressora');
    expect(sent?.description).toContain(`Análise completa: ${window.location.origin}/logs?aba=analises&analise=3`);
    expect(await within(machines).findByRole('link', { name: 'Incidente #77' })).toHaveAttribute('href', '/chamados/77');
    expect(await screen.findByText('Incidente #77 aberto em PC-RECEPCAO.')).toBeInTheDocument();
  });

  it('explica a restrição para quem vê só alguns clientes', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['logs.view'] })),
      'GET /api/assistant/insights': () => problem(403, 'FORBIDDEN', 'Restrito'),
    });
    renderApp('/logs?aba=analises');
    expect(await screen.findByText(/ficam disponíveis só para quem vê todos eles/)).toBeInTheDocument();
  });

  it('descreve a tendência da recorrência', () => {
    expect(trendLabel(5, 0)).toEqual({ text: 'novo no período', up: true });
    expect(trendLabel(5, 5)).toEqual({ text: 'estável', up: null });
    expect(trendLabel(5, 10)).toEqual({ text: '-50% em relação ao período anterior', up: false });
  });
});
