import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetSheet, SetResponsibleRequest } from '../../api/types';
import { makeAssetSheet, makePerson } from '../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

function readBody(init: RequestInit | undefined): SetResponsibleRequest {
  return JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as SetResponsibleRequest;
}

function withResponsible(personId: number, name: string): AssetSheet {
  return makeAssetSheet({
    suggestedPerson: null,
    responsible: { personId, name, email: null, phone: null, department: 'Recepção', assignedAt: '2026-10-01T11:00:00Z', assignedBy: 'tecnico' },
    history: [{ id: 1, personId, personName: name, assignedAt: '2026-10-01T11:00:00Z', unassignedAt: null, assignedBy: 'tecnico', notes: null }],
  });
}

describe('ficha do ativo', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('mostra hardware e sugestão, atribui a sugestão e troca o responsável', async () => {
    const sent: SetResponsibleRequest[] = [];
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['inventory.view', 'inventory.manage'] })),
      'GET /api/assets/7': () => json(makeAssetSheet()),
      'GET /api/people': () => json({ items: [makePerson(), makePerson({ id: 6, name: 'João Lima', department: 'Financeiro' })], total: 2, page: 1, pageSize: 100 }),
      'PUT /api/assets/7/responsible': (init) => {
        const body = readBody(init);
        sent.push(body);
        return json(body.personId === 6 ? withResponsible(6, 'João Lima') : withResponsible(5, 'Maria Souza'));
      },
    });
    renderApp('/inventario/7');

    expect(await screen.findByRole('heading', { name: 'PC-RECEPCAO', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('PAT-0042')).toBeInTheDocument();
    const hardware = screen.getByRole('region', { name: 'Hardware' });
    expect(within(hardware).getByText('Intel Core i5-11500')).toBeInTheDocument();
    expect(within(hardware).getByText('16 GB')).toBeInTheDocument();
    expect(within(hardware).getByText('Coletado pelo agente')).toBeInTheDocument();

    const card = screen.getByRole('region', { name: 'Responsável' });
    expect(within(card).getByText('Sem responsável.')).toBeInTheDocument();
    expect(within(card).getByText('Sugestão: Maria Souza')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: 'Atribuir sugestão' }));
    await waitFor(() => expect(sent[0]).toEqual({ personId: 5 }));
    expect(await within(card).findByRole('link', { name: 'Maria Souza' })).toHaveAttribute('href', '/inventario/pessoas/5');
    expect(within(card).queryByText('Sugestão: Maria Souza')).not.toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Trocar' }));
    const select = within(card).getByRole('combobox', { name: 'Nova pessoa responsável' });
    await user.click(select);
    const listbox = document.getElementById(select.getAttribute('aria-controls') ?? '') as HTMLElement;
    await user.click(await within(listbox).findByRole('option', { name: 'João Lima (Financeiro)', hidden: true }));
    await user.type(within(card).getByRole('textbox', { name: 'Observação' }), 'Troca de setor');
    await user.click(within(card).getByRole('button', { name: 'Salvar responsável' }));

    await waitFor(() => expect(sent[1]).toEqual({ personId: 6, notes: 'Troca de setor' }));
    expect(await within(card).findByRole('link', { name: 'João Lima' })).toBeInTheDocument();
  });

  it('revela a senha da credencial por 30 segundos', async () => {
    const reveal = vi.fn(() => json({ secret: 'S3nh@Forte' }));
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['inventory.view', 'credentials.reveal'] })),
      'GET /api/assets/7': () => json(makeAssetSheet({ credentials: [{ id: 3, name: 'Admin local', username: 'administrador', url: null }] })),
      'POST /api/credentials/3/reveal': reveal,
    });
    renderApp('/inventario/7');

    const card = await screen.findByRole('region', { name: 'Credenciais' });
    expect(within(card).getByText('Admin local')).toBeInTheDocument();
    expect(within(card).queryByText('S3nh@Forte')).not.toBeInTheDocument();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(within(card).getByRole('button', { name: 'Revelar senha de Admin local' }));

    expect(await within(card).findByText('S3nh@Forte')).toBeInTheDocument();
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(within(card).getByRole('button', { name: 'Copiar senha' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(within(card).queryByText('S3nh@Forte')).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Revelar senha de Admin local' })).toBeInTheDocument();
  });
});
