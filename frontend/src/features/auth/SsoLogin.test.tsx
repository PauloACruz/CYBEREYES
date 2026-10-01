import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, makeMe, mockFetch, problem, renderApp } from '../../test/utils';
import { SSO_GENERIC_ERROR } from './ssoMessages';

function ssoOptions(passwordLoginEnabled: boolean) {
  return mockFetch({
    'GET /api/auth/sso/providers': () =>
      json({
        providers: [
          { id: 3, name: 'Microsoft Entra ID' },
          { id: 4, name: 'Keycloak' },
        ],
        passwordLoginEnabled,
      }),
    'GET /api/auth/me': () => problem(401, 'UNAUTHENTICATED', 'Sessão expirada'),
    'GET /api/auth/2fa/setup': () => json({ sharedKey: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/WinCare:tecnico?secret=JBSWY3DPEHPK3PXP' }),
  });
}

describe('login com SSO', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra um botão por provedor que inicia o SSO voltando para a página de origem', async () => {
    ssoOptions(true);
    renderApp('/agentes?status=online');

    const entra = await screen.findByRole('link', { name: 'Entrar com Microsoft Entra ID' });
    expect(entra).toHaveAttribute('href', '/api/auth/sso/3/start?returnUrl=%2Fagentes%3Fstatus%3Donline');
    expect(screen.getByRole('link', { name: 'Entrar com Keycloak' })).toHaveAttribute('href', '/api/auth/sso/4/start?returnUrl=%2Fagentes%3Fstatus%3Donline');
    expect(screen.getByLabelText(/Usuário/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entrar com senha (administrador)' })).not.toBeInTheDocument();
  });

  it('esconde o formulário de senha quando o login por senha está desativado', async () => {
    ssoOptions(false);
    renderApp('/login');

    expect(await screen.findByRole('link', { name: 'Entrar com Microsoft Entra ID' })).toHaveAttribute('href', '/api/auth/sso/3/start?returnUrl=%2F');
    expect(screen.queryByLabelText(/Usuário/)).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Entrar com senha (administrador)' }));

    expect(screen.getByLabelText(/Usuário/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });

  it.each([
    ['SSO_USER_NOT_FOUND', 'Sua conta não tem acesso a este console. Peça a um administrador para liberar seu usuário.'],
    ['SSO_DOMAIN_NOT_ALLOWED', 'O domínio do seu e-mail não tem permissão para entrar por este provedor.'],
    ['SSO_INVALID_STATE', 'A tentativa de login expirou ou foi aberta em outra janela. Clique de novo no botão do provedor.'],
    ['QUALQUER_OUTRO', SSO_GENERIC_ERROR],
  ])('mostra mensagem amigável para ssoError=%s', async (code, message) => {
    ssoOptions(true);
    renderApp(`/login?ssoError=${code}`);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível entrar');
    expect(alert).toHaveTextContent(message);
  });

  it('sso=2fa abre a etapa do código e sso=setup a configuração de 2FA', async () => {
    ssoOptions(true);
    const first = renderApp('/login?sso=2fa');
    expect(await screen.findByRole('heading', { name: 'Verificação em duas etapas' })).toBeInTheDocument();
    expect(first.router.state.location.pathname).toBe('/login/2fa');
    first.unmount();

    vi.unstubAllGlobals();
    mockFetch({
      'GET /api/auth/sso/providers': () => json({ providers: [], passwordLoginEnabled: true }),
      'GET /api/auth/me': () => json(makeMe({ twoFactorEnabled: false, mfaSatisfied: false })),
      'GET /api/auth/2fa/setup': () => json({ sharedKey: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/WinCare:tecnico?secret=JBSWY3DPEHPK3PXP' }),
    });
    const second = renderApp('/login?sso=setup');
    expect(await screen.findByRole('heading', { name: 'Configurar verificação em duas etapas' })).toBeInTheDocument();
    expect(second.router.state.location.pathname).toBe('/2fa/setup');
  });
});
