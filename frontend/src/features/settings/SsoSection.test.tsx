import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OidcProviderDto, SaveOidcProvider } from '../../api/types';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

const PROVIDER: OidcProviderDto = {
  id: 3,
  name: 'Microsoft Entra ID',
  authority: 'https://login.microsoftonline.com/tenant/v2.0',
  clientId: 'cybereyes-console',
  scopes: 'openid profile email',
  usernameClaim: 'preferred_username',
  linkByEmail: true,
  autoProvision: false,
  defaultRoleId: null,
  allowedDomains: ['empresa.com.br'],
  trustProviderMfa: false,
  enabled: true,
  hasClientSecret: true,
  redirectUri: 'https://console.empresa.com.br/api/auth/sso/callback',
  userCount: 2,
};

function bodyOf(init: RequestInit | undefined): unknown {
  return JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
}

describe('seção de SSO nas configurações', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lista provedores, testa a descoberta e salva mantendo o segredo em branco', async () => {
    let updated: SaveOidcProvider | undefined;
    let tested: unknown;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['settings.manage'] })),
      'GET /api/sso/providers': () => json([PROVIDER]),
      'GET /api/sso/settings': () => json({ disablePasswordLogin: false }),
      'GET /api/roles/options': () => json([{ id: 'r1', name: 'Técnico' }]),
      'POST /api/sso/providers/test': (init) => {
        tested = bodyOf(init);
        return json({ ok: true, issuer: 'https://login.microsoftonline.com/tenant/v2.0', authorizationEndpoint: 'https://login.microsoftonline.com/authorize' });
      },
      'PUT /api/sso/providers/3': (init) => {
        updated = bodyOf(init) as SaveOidcProvider;
        return json({ ...PROVIDER, ...updated });
      },
    });
    renderApp('/configuracoes');

    const section = await screen.findByRole('region', { name: 'SSO (OIDC)' });
    const row = await within(section).findByRole('row', { name: /Microsoft Entra ID/ });
    expect(within(row).getByText('2')).toBeInTheDocument();
    expect(within(section).getByText(PROVIDER.redirectUri)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Copiar URI de redirecionamento' })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: 'Editar provedor Microsoft Entra ID' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar provedor Microsoft Entra ID' });
    expect(within(dialog).getByText('Deixe em branco para manter o segredo atual')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Testar descoberta' }));
    expect(await within(dialog).findByText('Descoberta lida com sucesso')).toBeInTheDocument();
    expect(tested).toEqual({ authority: PROVIDER.authority });

    const name = within(dialog).getByRole('textbox', { name: /Nome/ });
    await user.clear(name);
    await user.type(name, 'Entra ID');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(updated).toBeDefined());
    expect(updated).not.toHaveProperty('clientSecret');
    expect(updated).toMatchObject({ name: 'Entra ID', authority: PROVIDER.authority, allowedDomains: ['empresa.com.br'], enabled: true });
  });

  it('valida a authority e pede confirmação para desativar o login por senha', async () => {
    const saveSettings = vi.fn((init: RequestInit | undefined) => json(bodyOf(init)));
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['settings.manage'] })),
      'GET /api/sso/providers': () => json([]),
      'GET /api/sso/settings': () => json({ disablePasswordLogin: false }),
      'GET /api/roles/options': () => json([]),
      'PUT /api/sso/settings': saveSettings,
    });
    renderApp('/configuracoes');

    const section = await screen.findByRole('region', { name: 'SSO (OIDC)' });
    expect(await within(section).findByText('Nenhum provedor de identidade configurado.')).toBeInTheDocument();
    const user = userEvent.setup();

    await user.click(within(section).getByRole('button', { name: 'Novo provedor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo provedor OIDC' });
    await user.type(within(dialog).getByRole('textbox', { name: /Authority/ }), 'http://idp.empresa.com.br');
    await user.click(within(dialog).getByRole('button', { name: 'Criar provedor' }));
    expect(await within(dialog).findByText('Use https (http só para localhost)')).toBeInTheDocument();
    expect(within(dialog).getByText('Informe o segredo do cliente')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await user.click(within(section).getByRole('switch', { name: /Desativar login por senha/ }));
    const confirm = await screen.findByRole('dialog', { name: 'Desativar login por senha' });
    expect(saveSettings).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Desativar login por senha' }));

    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    expect(bodyOf(saveSettings.mock.calls[0]?.[0])).toEqual({ disablePasswordLogin: true });
    await waitFor(() => expect(within(section).getByRole('switch', { name: /Desativar login por senha/ })).toBeChecked());
  });
});
