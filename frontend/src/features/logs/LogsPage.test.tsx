import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogEntryDto, LogSummaryDto } from '../../api/types';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

function makeLog(overrides: Partial<LogEntryDto>): LogEntryDto {
  return {
    id: 1,
    time: '2026-10-01T10:00:00Z',
    receivedAt: '2026-10-01T10:00:05Z',
    agentId: 1,
    hostname: 'PC-RECEPCAO',
    deviceId: null,
    deviceName: null,
    clientName: 'Clínica Central',
    level: 'error',
    source: 'Service Control Manager',
    log: 'System',
    eventId: 7031,
    message: 'O serviço Spooler foi encerrado inesperadamente.',
    ...overrides,
  };
}

const SUMMARY: LogSummaryDto = {
  byLevel: { critical: 3, error: 12, warning: 40, info: 250 },
  bySource: [
    { source: 'Service Control Manager', count: 30 },
    { source: 'Microsoft-Windows-Kernel-Power', count: 8 },
  ],
  perHour: [
    { hour: '2026-10-01T09:00:00Z', critical: 1, error: 5, warning: 20, info: 100 },
    { hour: '2026-10-01T10:00:00Z', critical: 2, error: 7, warning: 20, info: 150 },
  ],
};

describe('página de Logs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('filtra por nível e texto e carrega mais pelo cursor nextBefore', async () => {
    const requests: URL[] = [];
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['logs.view'] })),
      'GET /api/logs/summary': () => json(SUMMARY),
      'GET /api/logs': (_init, url) => {
        requests.push(url);
        if (url.searchParams.get('before') === 'cursor-1') {
          return json({ items: [makeLog({ id: 3, message: 'Evento mais antigo da segunda página' })], nextBefore: null });
        }
        return json({
          items: [makeLog({ id: 1 }), makeLog({ id: 2, level: 'warning', source: 'Kernel-Power', message: 'Desligamento inesperado' })],
          nextBefore: 'cursor-1',
        });
      },
    });
    renderApp('/logs');
    const user = userEvent.setup();

    expect(await screen.findByText('O serviço Spooler foi encerrado inesperadamente.')).toBeInTheDocument();
    const first = requests[0];
    expect(first?.searchParams.get('from')).toBeTruthy();
    expect(first?.searchParams.get('before')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Evento mais antigo da segunda página')).toBeInTheDocument();
    expect(requests.some((r) => r.searchParams.get('before') === 'cursor-1')).toBe(true);
    expect(screen.getByText('O serviço Spooler foi encerrado inesperadamente.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument());

    await user.click(screen.getByRole('combobox', { name: 'Nível mínimo' }));
    await user.click(await screen.findByRole('option', { name: 'Erro', hidden: true }));
    await user.type(screen.getByRole('textbox', { name: 'Texto' }), 'Spooler');
    await waitFor(() => {
      const last = requests[requests.length - 1];
      expect(last?.searchParams.get('level')).toBe('error');
      expect(last?.searchParams.get('search')).toBe('Spooler');
      expect(last?.searchParams.get('before')).toBeNull();
    });

    await user.click(screen.getByText('O serviço Spooler foi encerrado inesperadamente.'));
    expect(await screen.findByLabelText('Mensagem completa')).toHaveTextContent('O serviço Spooler foi encerrado inesperadamente.');
    expect(screen.getByText('7031')).toBeInTheDocument();
  });

  it('mostra o resumo com a contagem por nível e as principais origens', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['logs.view'] })),
      'GET /api/logs/summary': () => json(SUMMARY),
      'GET /api/logs': () => json({ items: [], nextBefore: null }),
    });
    renderApp('/logs');

    const counts = await screen.findByRole('list', { name: 'Contagem por nível' });
    expect(within(counts).getByRole('listitem', { name: 'Crítico: 3' })).toBeInTheDocument();
    expect(within(counts).getByRole('listitem', { name: 'Erro: 12' })).toBeInTheDocument();
    expect(within(counts).getByRole('listitem', { name: 'Aviso: 40' })).toBeInTheDocument();
    expect(within(counts).getByRole('listitem', { name: 'Informação: 250' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filtrar pela origem Service Control Manager (30 eventos)' })).toBeInTheDocument();
    expect(screen.getByText('Nenhum log encontrado com estes filtros.')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ver tabela' }));
    expect(screen.getByRole('columnheader', { name: 'Crítico' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '150' })).toBeInTheDocument();
  });
});
