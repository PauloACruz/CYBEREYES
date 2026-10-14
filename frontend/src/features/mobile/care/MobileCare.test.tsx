import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HealthReport, StartCareRunRequest } from '../../../api/types';
import { makeAgentDetail, makeCareCatalog, makeCareRun } from '../../../test/fixtures';
import { json, makeMe, mockFetch, problem, renderApp } from '../../../test/utils';
import { CARE_NAME } from '../../care/careFormat';

const RUN_ID = 'wc-0123456789abcdef0123456789abcdef';

const report: HealthReport = {
  score: 64,
  grade: 'atencao',
  collectedAt: '2026-10-01T09:00:00Z',
  platform: 'windows',
  items: [
    { key: 'cpu', label: 'CPU', category: 'desempenho', status: 'ok', value: '12%', detail: '', weight: 10, points: 10 },
    { key: 'disk', label: 'Discos', category: 'armazenamento', status: 'warning', value: 'C: 9% livre', detail: '', weight: 15, points: 7 },
  ],
};

function careHandlers(extra: Parameters<typeof mockFetch>[0] = {}) {
  return {
    'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view', 'care.run'] })),
    'GET /api/agents/1': () => json(makeAgentDetail()),
    'GET /api/agents/1/health': () => json(report),
    'GET /api/agents/1/care/catalog': () => json(makeCareCatalog()),
    'GET /api/agents/1/care/runs': () => json({ items: [makeCareRun({ status: 'ok', progress: 100 })], total: 1, page: 1, pageSize: 20 }),
    ...extra,
  };
}

describe(`${CARE_NAME} no app`, () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra a saúde agrupada por categoria e o histórico', async () => {
    mockFetch(careHandlers());
    renderApp('/app/agentes/1/care');
    const user = userEvent.setup();

    expect(await screen.findByLabelText(/Nota 64 de 100/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Saúde' })).toHaveAttribute('aria-selected', 'true');
    const storage = screen.getByRole('region', { name: 'Armazenamento' });
    expect(within(storage).getByText('Discos')).toBeInTheDocument();
    expect(within(storage).getByText('C: 9% livre')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Desempenho' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar para PC-RECEPCAO' })).toHaveAttribute('href', '/app/agentes/1');

    await user.click(screen.getByRole('tab', { name: 'Histórico' }));
    const run = await screen.findByRole('link', { name: /Manutenção/ });
    expect(run).toHaveAttribute('href', `/app/agentes/1/care/execucoes/${RUN_ID}`);
  });

  it('oferece a coleta quando o Health Check ainda não rodou', async () => {
    mockFetch(careHandlers({ 'GET /api/agents/1/health': () => problem(404, 'NOT_FOUND', 'Sem relatório') }));
    renderApp('/app/agentes/1/care');

    expect(await screen.findByText('O Health Check ainda não rodou nesta máquina.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coletar agora' })).toBeInTheDocument();
  });

  it('executa a manutenção e abre a execução em tempo real', async () => {
    let sent: StartCareRunRequest | undefined;
    mockFetch(
      careHandlers({
        'POST /api/agents/1/care/runs': (init) => {
          sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as StartCareRunRequest;
          return json(makeCareRun(), 202);
        },
        [`GET /api/care/runs/${RUN_ID}`]: () => json(makeCareRun({ events: [] })),
      }),
    );
    const { router } = renderApp('/app/agentes/1/care?aba=manutencao');
    const user = userEvent.setup();

    expect(await screen.findByRole('checkbox', { name: /Limpar arquivos temporários/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Executar' }));

    await waitFor(() => expect(sent).toEqual({ module: 'maintenance', tasks: ['temp'] }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/agentes/1/care/execucoes/${RUN_ID}`));
    const panel = await screen.findByRole('region', { name: `Execução do ${CARE_NAME}` });
    expect(within(panel).getByText('Em execução')).toBeInTheDocument();
    expect(screen.getByText(/a execução continua na máquina/)).toBeInTheDocument();
  });
});
