import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReportData, ReportRunDto, ReportTypeDto } from '../../api/types';
import { CLIENTS } from '../../test/fixtures';
import { json, makeMe, mockFetch, renderApp, type MockHandler } from '../../test/utils';

const TYPES: ReportTypeDto[] = [
  {
    type: 'snmp_availability',
    label: 'Disponibilidade SNMP',
    description: 'Quedas e disponibilidade dos dispositivos SNMP.',
    usesPeriod: true,
    filters: ['clientId'],
  },
  { type: 'agents', label: 'Agentes', description: 'Situação dos agentes.', usesPeriod: false, filters: ['clientId', 'siteId', 'status'] },
];

const PREVIEW: ReportData = {
  type: 'snmp_availability',
  title: 'Disponibilidade SNMP',
  generatedAt: '2026-10-01T12:00:00Z',
  periodFrom: '2026-09-24T03:00:00Z',
  periodTo: '2026-10-01T03:00:00Z',
  filtersText: ['Cliente: Clínica Central'],
  summary: [
    { label: 'Disponibilidade média', value: '99,5%' },
    { label: 'Dispositivos com queda', value: 1 },
  ],
  columns: [
    { key: 'name', label: 'Dispositivo', kind: 'text' },
    { key: 'downs', label: 'Quedas', kind: 'number' },
    { key: 'downtime', label: 'Tempo fora', kind: 'duration' },
    { key: 'availability', label: 'Disponibilidade', kind: 'percent' },
    { key: 'since', label: 'Desde', kind: 'date' },
  ],
  rows: [{ name: 'SW-CORE', downs: 2, downtime: 3720, availability: 98.25, since: '2026-09-01' }],
  truncated: true,
};

const RUN: ReportRunDto = {
  id: 42,
  type: 'snmp_availability',
  title: 'Disponibilidade SNMP',
  format: 'pdf',
  status: 'ok',
  error: null,
  fileName: 'disponibilidade-snmp.pdf',
  size: 2048,
  createdAt: '2026-10-01T12:00:00Z',
  requestedBy: 'tecnico',
  scheduleId: null,
  emailedTo: [],
};

async function pick(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  const combobox = await screen.findByRole('combobox', { name: label });
  await user.click(combobox);
  await waitFor(() => expect(combobox.getAttribute('aria-controls')).toBeTruthy());
  const listbox = document.getElementById(combobox.getAttribute('aria-controls') ?? '') as HTMLElement;
  await user.click(await within(listbox).findByRole('option', { name: option, hidden: true }));
}

function bodyOf(init: RequestInit | undefined): unknown {
  return JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
}

describe('página de relatórios', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra a prévia formatada e gera o PDF com link de download', async () => {
    let previewBody: unknown;
    let runBody: unknown;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['reports.view', 'clients.view'] })),
      'GET /api/reports/types': () => json(TYPES),
      'GET /api/clients': () => json(CLIENTS),
      'POST /api/reports/preview': (init) => {
        previewBody = bodyOf(init);
        return json(PREVIEW);
      },
      'POST /api/reports/runs': (init) => {
        runBody = bodyOf(init);
        return json(RUN, 201);
      },
    });
    renderApp('/relatorios');

    expect(await screen.findByText('Quedas e disponibilidade dos dispositivos SNMP.')).toBeInTheDocument();
    const user = userEvent.setup();

    await pick(user, 'Período', 'Últimos 30 dias');
    await pick(user, 'Cliente', 'Clínica Central');
    await user.click(screen.getByRole('button', { name: 'Visualizar' }));

    await waitFor(() => expect(previewBody).toEqual({ type: 'snmp_availability', clientId: 1, period: 'last_30d' }));
    const preview = await screen.findByRole('region', { name: 'Disponibilidade SNMP' });
    expect(within(preview).getByText('Prévia limitada')).toBeInTheDocument();
    expect(within(preview).getByText('Filtros: Cliente: Clínica Central')).toBeInTheDocument();
    expect(within(preview).getByText('99,5%')).toBeInTheDocument();
    const row = within(preview).getByRole('row', { name: /SW-CORE/ });
    expect(within(row).getByText('1 h 2 min')).toBeInTheDocument();
    expect(within(row).getByText('98,25%')).toBeInTheDocument();
    expect(within(row).getByText('01/09/2026')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Gerar PDF' }));

    await waitFor(() => expect(runBody).toEqual({ type: 'snmp_availability', clientId: 1, period: 'last_30d', format: 'pdf' }));
    const download = await screen.findByRole('link', { name: /Baixar disponibilidade-snmp.pdf/ });
    expect(download).toHaveAttribute('href', '/api/reports/runs/42/download');
  });

  it('não envia período para tipos sem período e exige datas no intervalo personalizado', async () => {
    const preview = vi.fn<MockHandler>(() => json({ ...PREVIEW, type: 'agents', title: 'Agentes', summary: [], rows: [], truncated: false }));
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['reports.view'] })),
      'GET /api/reports/types': () => json(TYPES),
      'POST /api/reports/preview': preview,
    });
    renderApp('/relatorios');
    const user = userEvent.setup();

    await pick(user, 'Período', 'Personalizado');
    await user.click(screen.getByRole('button', { name: 'Visualizar' }));
    expect(await screen.findByText('Escolha o intervalo de datas.')).toBeInTheDocument();
    expect(preview).not.toHaveBeenCalled();

    await pick(user, 'Tipo de relatório', 'Agentes');
    expect(screen.queryByRole('combobox', { name: 'Período' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Visualizar' }));

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    expect(bodyOf(preview.mock.calls[0]?.[0])).toEqual({ type: 'agents' });
    expect(await screen.findByText('Nenhum registro para os filtros escolhidos.')).toBeInTheDocument();
  });
});
