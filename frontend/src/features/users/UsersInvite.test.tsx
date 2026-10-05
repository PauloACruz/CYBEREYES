import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS, type UserDto } from '../../api/types';
import { json, makeMe, mockFetch, problem, renderApp } from '../../test/utils';

function makeUser(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'u-convidado',
    username: 'joao.tecnico',
    email: 'joao@exemplo.com',
    fullName: 'João Souza',
    isActive: true,
    twoFactorEnabled: false,
    roles: [],
    lastLoginAt: null,
    createdAt: '2026-10-05T12:00:00Z',
    invitePending: false,
    ...overrides,
  };
}

const manager = makeMe({ permissions: [PERMISSIONS.usersView, PERMISSIONS.usersManage] });

function usersApiMock(items: UserDto[], extra: Parameters<typeof mockFetch>[0] = {}) {
  return mockFetch({
    'GET /api/auth/me': () => json(manager),
    'GET /api/users': () => json({ items, total: items.length, page: 1, pageSize: 25 }),
    'GET /api/roles/options': () => json([]),
    ...extra,
  });
}

function postBody(fetchMock: ReturnType<typeof mockFetch>, path: string): unknown {
  const call = fetchMock.mock.calls.find(([input, init]) => init?.method === 'POST' && new URL((typeof input === 'string' ? input : ''), 'http://x').pathname === path);
  return call?.[1]?.body ? JSON.parse(call[1].body as string) : undefined;
}

async function fillNewUser() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Novo usuário' }));
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByRole('textbox', { name: /^Usuário/ }), 'joao.tecnico');
  await user.type(within(dialog).getByLabelText(/Nome completo/), 'João Souza');
  await user.type(within(dialog).getByLabelText(/E-mail/), 'joao@exemplo.com');
  return { user, dialog };
}

describe('convite de usuarios', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('novo usuario usa convite por e-mail por padrao, sem senha', async () => {
    const fetchMock = usersApiMock([], {
      'POST /api/users': () => json(makeUser({ invitePending: true }), 201),
    });
    renderApp('/usuarios');
    const { user, dialog } = await fillNewUser();

    expect(within(dialog).queryByLabelText(/Senha inicial/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Criar usuário' }));

    expect(await screen.findByText('Usuário criado. Convite enviado para joao@exemplo.com.')).toBeInTheDocument();
    expect(postBody(fetchMock, '/api/users')).toEqual({
      email: 'joao@exemplo.com',
      fullName: 'João Souza',
      roleIds: [],
      isActive: true,
      username: 'joao.tecnico',
      sendInvite: true,
    });
  });

  it('opcao "Definir senha agora" exige e envia a senha inicial', async () => {
    const fetchMock = usersApiMock([], { 'POST /api/users': () => json(makeUser(), 201) });
    renderApp('/usuarios');
    const { user, dialog } = await fillNewUser();

    await user.click(within(dialog).getByText('Definir senha agora'));
    await user.click(within(dialog).getByRole('button', { name: 'Criar usuário' }));
    expect(await within(dialog).findByText('Informe a senha inicial')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Senha inicial/), 'senha-inicial-123');
    await user.click(within(dialog).getByRole('button', { name: 'Criar usuário' }));

    expect(await screen.findByText('Usuário criado.')).toBeInTheDocument();
    expect(postBody(fetchMock, '/api/users')).toMatchObject({ password: 'senha-inicial-123' });
    expect(postBody(fetchMock, '/api/users')).not.toHaveProperty('sendInvite');
  });

  it('SMTP nao configurado aparece no formulario', async () => {
    usersApiMock([], {
      'POST /api/users': () =>
        json(
          {
            title: 'Dados invalidos',
            status: 400,
            code: 'VALIDATION_ERROR',
            errors: { sendInvite: ['Configure o SMTP (Configuracoes > E-mail) antes de enviar convites'] },
          },
          400,
        ),
    });
    renderApp('/usuarios');
    const { user, dialog } = await fillNewUser();

    await user.click(within(dialog).getByRole('button', { name: 'Criar usuário' }));

    expect(await within(dialog).findByText(/Configure o SMTP/)).toBeInTheDocument();
  });

  it('convite pendente aparece na lista e pode ser reenviado', async () => {
    const fetchMock = usersApiMock([makeUser({ invitePending: true })], {
      'POST /api/users/u-convidado/invite': () => new Response(null, { status: 204 }),
    });
    renderApp('/usuarios');
    const user = userEvent.setup();

    expect(await screen.findByText('Convite pendente')).toBeInTheDocument();
    expect(screen.queryByText('Sem 2FA')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ações para joao.tecnico' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reenviar convite' }));

    expect(await screen.findByText(/Convite reenviado para joao@exemplo.com/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input, init]) => init?.method === 'POST' && (typeof input === 'string' ? input : '').includes('/api/users/u-convidado/invite'))).toBe(true);
  });

  it('falha no reenvio mostra o erro do servidor', async () => {
    usersApiMock([makeUser({ invitePending: true })], {
      'POST /api/users/u-convidado/invite': () => problem(400, 'VALIDATION_ERROR', 'Falha ao enviar o convite: SMTP recusou a autenticacao'),
    });
    renderApp('/usuarios');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Ações para joao.tecnico' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reenviar convite' }));

    expect(await screen.findByText(/SMTP recusou a autenticacao/)).toBeInTheDocument();
  });
});
