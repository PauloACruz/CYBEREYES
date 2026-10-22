import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateApiKeyRequest, UserDto } from '../../api/types';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

const agentUser: UserDto = {
  id: 'u-ia',
  username: 'agente.ia',
  email: 'agente.ia@exemplo.com',
  fullName: 'Assistente IA',
  isActive: true,
  twoFactorEnabled: false,
  roles: [],
  lastLoginAt: null,
  createdAt: '2026-10-01T10:00:00Z',
  allClients: true,
  clients: [],
  invitePending: false,
  rolesRestrictClients: false,
};

describe('chaves de API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra o endereço do MCP e deixa o superusuário criar a chave do agente de IA', async () => {
    let sent: CreateApiKeyRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ id: 'u1', username: 'admin', isSuperuser: true, permissions: ['apikeys.manage', 'settings.manage', 'users.view'] })),
      'GET /api/apikeys': () => json([]),
      'GET /api/users': () => json({ items: [agentUser], total: 1, page: 1, pageSize: 100 }),
      'POST /api/apikeys': (init) => {
        sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as CreateApiKeyRequest;
        return json(
          { id: 'k1', name: sent.name, prefix: 'cyk_ab12', username: 'agente.ia', expiresAt: null, createdAt: '2026-10-19T12:00:00Z', lastUsedAt: null, key: 'cyk_ab12_segredo' },
          201,
        );
      },
    });
    renderApp('/chaves-api');

    const mcp = await screen.findByRole('region', { name: 'Agentes de IA (MCP)' });
    expect(within(mcp).getByText(`${window.location.origin}/api/mcp`)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Nova chave' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nova chave de API' });
    await user.type(within(dialog).getByRole('textbox', { name: /Nome/ }), 'Agente de IA');
    await user.click(within(dialog).getByRole('combobox', { name: /Dono da chave/ }));
    await user.click(await screen.findByRole('option', { name: 'Assistente IA (agente.ia)', hidden: true }));
    await user.click(within(dialog).getByRole('button', { name: 'Criar chave' }));

    await waitFor(() => expect(sent).toEqual({ name: 'Agente de IA', userId: 'u-ia' }));
    expect(await screen.findByText('cyk_ab12_segredo')).toBeInTheDocument();
  });

  it('sem superusuário a chave é sempre de quem cria', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['apikeys.manage', 'settings.manage'] })),
      'GET /api/apikeys': () => json([]),
    });
    renderApp('/chaves-api');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Nova chave' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nova chave de API' });
    expect(within(dialog).queryByRole('combobox', { name: /Dono da chave/ })).not.toBeInTheDocument();
  });
});
