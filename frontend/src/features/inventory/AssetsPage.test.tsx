import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIENTS, makeAsset } from '../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

const assets = [
  makeAsset({ responsible: { id: 5, name: 'Maria Souza' } }),
  makeAsset({
    id: 8,
    agentId: null,
    agentStatus: null,
    type: 'printer',
    name: 'Impressora recepção',
    manufacturer: 'HP',
    model: 'LaserJet M428',
    serialNumber: 'HP998877',
    assetTag: 'PAT-0050',
    status: 'maintenance',
    ipAddress: '192.168.1.50',
  }),
];

async function choose(user: ReturnType<typeof userEvent.setup>, combobox: HTMLElement, option: string) {
  await user.click(combobox);
  await waitFor(() => expect(combobox.getAttribute('aria-controls')).toBeTruthy());
  const listbox = document.getElementById(combobox.getAttribute('aria-controls') ?? '') as HTMLElement;
  await user.click(await within(listbox).findByRole('option', { name: option, hidden: true }));
}

describe('lista de ativos', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra as colunas do inventário e filtra por tipo', async () => {
    const fetchMock = mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['inventory.view'] })),
      'GET /api/clients': () => json(CLIENTS),
      'GET /api/assets': (_, url) => {
        const type = url.searchParams.get('type');
        const items = type ? assets.filter((a) => a.type === type) : assets;
        return json({ items, total: items.length, page: 1, pageSize: 50 });
      },
    });
    renderApp('/inventario');

    const row = (await screen.findByRole('link', { name: 'PC-RECEPCAO' })).closest('tr') as HTMLElement;
    const cells = within(row);
    expect(cells.getByRole('img', { name: 'Estação' })).toBeInTheDocument();
    expect(cells.getByText('Dell OptiPlex 7090')).toBeInTheDocument();
    expect(cells.getByText('PAT-0042')).toBeInTheDocument();
    expect(cells.getByText('192.168.1.20')).toBeInTheDocument();
    expect(cells.getByRole('link', { name: 'Maria Souza' })).toHaveAttribute('href', '/inventario/pessoas/5');
    expect(cells.getByText('Em uso')).toBeInTheDocument();
    expect(cells.getByText('Online')).toBeInTheDocument();
    const printerRow = screen.getByRole('link', { name: 'Impressora recepção' }).closest('tr') as HTMLElement;
    expect(within(printerRow).getByText('Manutenção')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Novo ativo' })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await choose(user, screen.getByRole('combobox', { name: 'Filtrar por tipo' }), 'Impressora');

    await waitFor(() => expect(screen.queryByRole('link', { name: 'PC-RECEPCAO' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Impressora recepção' })).toBeInTheDocument();
    const urls = fetchMock.mock.calls.map(([input]) => (typeof input === 'string' ? input : ''));
    expect(urls.some((u) => u.startsWith('/api/assets?') && u.includes('type=printer'))).toBe(true);
  });
});
