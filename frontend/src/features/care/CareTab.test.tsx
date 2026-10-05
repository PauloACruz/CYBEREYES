import { HubConnectionBuilder } from '@microsoft/signalr';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CareEvent, HealthReport, StartCareRunRequest } from '../../api/types';
import { makeAgentDetail, makeAssetSheet, makeCareCatalog, makeCareRun } from '../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';
import { CARE_NAME } from './careFormat';

const RUN_ID = 'wc-0123456789abcdef0123456789abcdef';
const me = makeMe({ permissions: ['agents.view', 'care.run'] });

function baseHandlers(extra: Parameters<typeof mockFetch>[0] = {}) {
  return {
    'GET /api/auth/me': () => json(me),
    'GET /api/agents/1': () => json(makeAgentDetail()),
    'GET /api/agents/1/care/catalog': () => json(makeCareCatalog()),
    'GET /api/agents/1/care/runs': () => json({ items: [], total: 0, page: 1, pageSize: 10 }),
    ...extra,
  };
}

describe(`aba ${CARE_NAME} do agente`, () => {
  afterEach(() => vi.unstubAllGlobals());

  it('usa o nome fixo do módulo, que não acompanha o branding', () => {
    expect(CARE_NAME).toBe('Cybereyes Care');
  });

  it('mostra o catálogo, valida parâmetros e pede confirmação da tarefa que exige atenção', async () => {
    let sent: StartCareRunRequest | undefined;
    mockFetch(
      baseHandlers({
        'POST /api/agents/1/care/runs': (init) => {
          sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as StartCareRunRequest;
          return json(makeCareRun(), 202);
        },
        [`GET /api/care/runs/${RUN_ID}`]: () => json(makeCareRun({ events: [] })),
      }),
    );
    renderApp('/agentes/1?aba=care');

    const temp = await screen.findByRole('checkbox', { name: /Limpar arquivos temporários/ });
    expect(temp).toBeChecked();
    expect(screen.getByRole('tab', { name: CARE_NAME })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Limpeza')).toBeInTheDocument();
    expect(screen.getByText('Reparo')).toBeInTheDocument();
    expect(screen.getByText('Exige reinício')).toBeInTheDocument();
    expect(screen.getByText('Atenção')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: /Reparar imagem \(DISM\)/ }));
    await user.click(screen.getByRole('button', { name: 'Executar' }));
    expect(await screen.findByText('Campo obrigatório')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: /Origem da imagem/ }), 'E:');
    await user.click(screen.getByRole('button', { name: 'Executar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Reparar imagem (DISM)')).toBeInTheDocument();
    expect(within(dialog).queryByText('Limpar arquivos temporários')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Executar' }));

    await waitFor(() => expect(sent).toEqual({ module: 'maintenance', tasks: ['temp', 'dism'], params: { source: 'E:' } }));
    const panel = await screen.findByRole('region', { name: `Execução do ${CARE_NAME}` });
    expect(within(panel).getByText('Em execução')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('acrescenta os eventos do hub na ordem de seq, sem duplicar, e mostra o resultado final', async () => {
    const log = (seq: number, message: string, level: 'INFO' | 'WARN' = 'INFO'): CareEvent => ({
      type: 'log',
      seq,
      time: '2026-10-01T10:00:00Z',
      level,
      message,
    });
    mockFetch(
      baseHandlers({
        'GET /api/agents/1/care/runs': () => json({ items: [makeCareRun()], total: 1, page: 1, pageSize: 10 }),
        [`GET /api/care/runs/${RUN_ID}`]: () => json(makeCareRun({ events: [log(1, 'Etapa 1')] })),
      }),
    );
    const hub = new HubConnectionBuilder().build() as unknown as { invoke: Mock; on: Mock };
    renderApp('/agentes/1?aba=care');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('cell', { name: 'Manutenção' }));
    const console = await screen.findByRole('log', { name: 'Log da execução' });
    await within(console).findByText('Etapa 1');
    await waitFor(() => expect(hub.invoke).toHaveBeenCalledWith('JoinCareRun', RUN_ID));

    const handlers = hub.on.mock.calls.filter(([event]) => event === 'careEvent');
    const onEvent = handlers[handlers.length - 1]?.[1] as (runId: string, event: CareEvent) => void;
    act(() => {
      onEvent(RUN_ID, log(3, 'Etapa 3', 'WARN'));
      onEvent(RUN_ID, log(2, 'Etapa 2'));
      onEvent(RUN_ID, log(2, 'Etapa 2'));
      onEvent(RUN_ID, log(1, 'Etapa 1'));
      onEvent('wc-ffffffffffffffffffffffffffffffff', log(4, 'Outra execução'));
      onEvent(RUN_ID, { type: 'task', seq: 4, time: '2026-10-01T10:01:00Z', key: 'temp', status: 'ok' });
      onEvent(RUN_ID, { type: 'progress', seq: 5, time: '2026-10-01T10:01:00Z', value: 50 });
      onEvent(RUN_ID, { type: 'result', seq: 6, time: '2026-10-01T10:01:00Z', data: [{ arquivo: 'C:/Temp', removidos: 12 }] });
      onEvent(RUN_ID, { type: 'done', seq: 7, time: '2026-10-01T10:02:00Z', status: 'ok', durationMs: 120_000, rebootRequired: true });
    });

    await waitFor(() => expect(within(console).getAllByText(/^Etapa/).map((el) => el.textContent)).toEqual(['Etapa 1', 'Etapa 2', 'Etapa 3']));
    expect(within(console).queryByText('Outra execução')).not.toBeInTheDocument();
    expect(within(console).getByText('Etapa 3').closest('[data-level]')).toHaveAttribute('data-level', 'WARN');

    const panel = screen.getByRole('region', { name: `Execução do ${CARE_NAME}` });
    const tasks = within(panel).getByRole('list', { name: 'Tarefas da execução' });
    expect(within(tasks).getByText('OK')).toBeInTheDocument();
    expect(within(tasks).getByText('Aguardando')).toBeInTheDocument();
    expect(within(panel).getByRole('cell', { name: 'C:/Temp' })).toBeInTheDocument();
    expect(within(panel).getByLabelText('Situação da execução')).toHaveTextContent('Concluído');
    expect(within(panel).getByText('Duração: 2 min 0 s.')).toBeInTheDocument();
    expect(within(panel).getByText('Reinicie a máquina para concluir as alterações.')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
  });
});

describe('card de saúde na ficha do ativo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra nota, faixa e itens, com item que não se aplica em cinza', async () => {
    const report: HealthReport = {
      score: 82,
      grade: 'bom',
      collectedAt: '2026-10-01T09:00:00Z',
      platform: 'windows',
      items: [
        { key: 'cpu', label: 'CPU', category: 'desempenho', status: 'ok', value: '12%', detail: 'Carga média baixa', weight: 10, points: 10 },
        { key: 'disk', label: 'Discos', category: 'armazenamento', status: 'warning', value: 'C: 9% livre', detail: 'Pouco espaço em C:', weight: 15, points: 7 },
        { key: 'updates', label: 'Atualizações pendentes', category: 'seguranca', status: 'unknown', value: '', detail: '', weight: 0, points: 0 },
      ],
    };
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['inventory.view', 'agents.view'] })),
      'GET /api/assets/7': () => json(makeAssetSheet()),
      'GET /api/agents/1/health': () => json(report),
    });
    renderApp('/inventario/7');

    const card = await screen.findByRole('region', { name: 'Saúde' });
    expect(await within(card).findByLabelText('Nota 82 de 100')).toHaveTextContent('82');
    expect(within(card).getByText('Bom')).toBeInTheDocument();
    expect(within(card).getByText('Discos')).toBeInTheDocument();
    expect(within(card).getByText('C: 9% livre')).toBeInTheDocument();
    expect(within(card).getByText('Pouco espaço em C:')).toBeInTheDocument();
    expect(within(card).getByText('Não se aplica')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Coletar agora' })).toBeInTheDocument();
  });
});
