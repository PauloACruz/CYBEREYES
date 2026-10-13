import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientDto } from '../../api/types';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

const CLIENTS: ClientDto[] = [
  { id: 1, name: 'Clínica Central', agentCount: 3, sites: [{ id: 10, clientId: 1, name: 'Matriz', agentCount: 2 }, { id: 11, clientId: 1, name: 'Filial', agentCount: 1 }] },
  { id: 2, name: 'Escritório Norte', agentCount: 1, sites: [{ id: 20, clientId: 2, name: 'Sede', agentCount: 1 }] },
];

describe('lista de clientes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('começa recolhida, abre os sites de um cliente e expande todos', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['clients.view', 'agents.view'] })),
      'GET /api/clients': () => json(CLIENTS),
    });
    renderApp('/clientes');
    const user = userEvent.setup();

    const central = await screen.findByRole('button', { name: 'Clínica Central' });
    expect(central).toHaveAttribute('aria-expanded', 'false');
    expect(within(screen.getByRole('region', { name: 'Clínica Central' })).getByText('2 sites')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Escritório Norte' })).toHaveAttribute('aria-expanded', 'false');

    await user.click(central);
    expect(central).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('Matriz')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Escritório Norte' })).toHaveAttribute('aria-expanded', 'false');

    await user.click(screen.getByRole('button', { name: 'Expandir todos' }));
    expect(screen.getByRole('button', { name: 'Escritório Norte' })).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('Sede')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Recolher todos' }));
    expect(central).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Expandir todos' })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('cybereyes:clientes-abertos') ?? 'null')).toEqual([]);
  });
});
