import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogInsightDetailDto, LogInsightSummaryDto } from '../../../api/types';
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

    await userEvent.setup().click(screen.getByRole('button', { name: 'Analisar agora' }));
    await waitFor(() => expect(ran).toBe(true));
    expect(await screen.findByText('Análise iniciada. Leva alguns minutos.')).toBeInTheDocument();
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
