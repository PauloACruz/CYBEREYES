import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS, type RoleDto } from '../../api/types';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

function makeRole(overrides: Partial<RoleDto> = {}): RoleDto {
  return {
    id: 'r-tecnico',
    name: 'Técnico',
    isSuperuser: false,
    permissions: ['agents.view'],
    userCount: 0,
    allClients: true,
    clients: [],
    ...overrides,
  };
}

function rolesApiMock(roles: RoleDto[], extra: Parameters<typeof mockFetch>[0] = {}) {
  return mockFetch({
    'GET /api/auth/me': () => json(makeMe({ permissions: [PERMISSIONS.rolesManage] })),
    'GET /api/roles': () => json(roles),
    'GET /api/roles/permissions': () => json([{ key: 'agents.view', group: 'Agentes', description: 'Ver agentes' }]),
    'GET /api/roles/client-options': () => json([{ id: 7, name: 'Acme' }, { id: 9, name: 'Globex' }]),
    ...extra,
  });
}

function sentBody(fetchMock: ReturnType<typeof mockFetch>, method: string, path: string): unknown {
  const call = fetchMock.mock.calls.find(([input, init]) => init?.method === method && new URL((typeof input === 'string' ? input : ''), 'http://x').pathname === path);
  return call?.[1]?.body ? JSON.parse(call[1].body as string) : undefined;
}

describe('papeis', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('restringe o novo papel aos clientes escolhidos', async () => {
    const fetchMock = rolesApiMock([], {
      'POST /api/roles': () => json(makeRole({ id: 'r-novo', name: 'Técnico Globex', allClients: false, clients: [{ id: 9, name: 'Globex' }] }), 201),
    });
    renderApp('/papeis');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Novo papel' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Nome/), 'Técnico Globex');

    await user.click(within(dialog).getByRole('switch', { name: /Acesso a todos os clientes/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Criar papel' }));
    expect(await within(dialog).findByText('Selecione ao menos um cliente')).toBeInTheDocument();

    await user.click(within(dialog).getByPlaceholderText('Selecione os clientes'));
    await user.click(await screen.findByRole('option', { name: 'Globex', hidden: true }));
    await user.click(within(dialog).getByRole('button', { name: 'Criar papel' }));

    expect(await screen.findByText('Papel criado.')).toBeInTheDocument();
    expect(sentBody(fetchMock, 'POST', '/api/roles')).toEqual({
      name: 'Técnico Globex',
      isSuperuser: false,
      permissions: [],
      allClients: false,
      clientIds: [9],
    });
  });

  it('papel de superusuario nao envia restricao de clientes', async () => {
    const restrito = makeRole({ allClients: false, clients: [{ id: 7, name: 'Acme' }] });
    const fetchMock = rolesApiMock([restrito], {
      'PUT /api/roles/r-tecnico': () => json(makeRole({ isSuperuser: true, allClients: false, clients: [{ id: 7, name: 'Acme' }] })),
    });
    renderApp('/papeis');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Editar Técnico' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('switch', { name: /Acesso a todos os clientes/ })).not.toBeChecked();

    await user.click(within(dialog).getByRole('switch', { name: /Superusuário/ }));
    expect(within(dialog).queryByRole('switch', { name: /Acesso a todos os clientes/ })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('Papel atualizado.')).toBeInTheDocument();
    expect(sentBody(fetchMock, 'PUT', '/api/roles/r-tecnico')).toEqual({ name: 'Técnico', isSuperuser: true, permissions: ['agents.view'] });
  });

  it('lista mostra os clientes dos papeis restritos', async () => {
    rolesApiMock([
      makeRole(),
      makeRole({
        id: 'r-parceiro',
        name: 'Parceiro',
        allClients: false,
        clients: [{ id: 1, name: 'Acme' }, { id: 2, name: 'Globex' }, { id: 3, name: 'Initech' }],
      }),
      makeRole({ id: 'r-admin', name: 'Administrador', isSuperuser: true, allClients: false, clients: [{ id: 1, name: 'Acme' }] }),
    ]);
    renderApp('/papeis');

    const parceiro = (await screen.findByText('Parceiro')).closest('tr')!;
    expect(within(parceiro).getByText('Acme')).toBeInTheDocument();
    expect(within(parceiro).getByText('Globex')).toBeInTheDocument();
    expect(within(parceiro).getByText('+1')).toBeInTheDocument();
    expect(within(screen.getByText('Técnico').closest('tr')!).getByText('Todos')).toBeInTheDocument();
    expect(within(screen.getByText('Administrador').closest('tr')!).getByText('Todos')).toBeInTheDocument();
  });
});
