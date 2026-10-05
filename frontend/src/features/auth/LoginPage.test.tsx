import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoginStatus } from '../../api/types';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

async function submitLogin() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Usuário/), 'tecnico');
  await user.type(screen.getByLabelText(/Senha/), 'segredo123');
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
}

function loginReturning(status: LoginStatus, me = makeMe()) {
  return mockFetch({
    'POST /api/auth/login': () => json({ status }),
    'GET /api/auth/me': () => json(me),
    'GET /api/auth/2fa/setup': () =>
      json({ sharedKey: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/Cybereyes:tecnico?secret=JBSWY3DPEHPK3PXP&issuer=Cybereyes' }),
  });
}

describe('fluxo de login', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('status "ok" vai ao painel', async () => {
    const fetchMock = loginReturning('ok');
    const { router } = renderApp('/login');

    await submitLogin();

    expect(await screen.findByRole('heading', { name: /Olá, Maria/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    const [, init] = fetchMock.mock.calls.find(([, call]) => call?.method === 'POST')!;
    expect(JSON.parse(init?.body as string)).toEqual({ username: 'tecnico', password: 'segredo123', rememberMe: false });
  });

  it('status "requires2fa" vai para o codigo TOTP com opcao de recuperacao', async () => {
    loginReturning('requires2fa');
    const { router } = renderApp('/login');

    await submitLogin();

    expect(await screen.findByRole('heading', { name: 'Verificação em duas etapas' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login/2fa');
    await userEvent.click(screen.getByRole('button', { name: 'Usar código de recuperação' }));
    expect(screen.getByLabelText(/Código de recuperação/)).toBeInTheDocument();
  });

  it('status "requires2faSetup" vai para a configuracao de 2FA', async () => {
    loginReturning('requires2faSetup', makeMe({ twoFactorEnabled: false, mfaSatisfied: false }));
    const { router } = renderApp('/login');

    await submitLogin();

    expect(await screen.findByRole('heading', { name: 'Configurar verificação em duas etapas' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/2fa/setup');
    await waitFor(() => expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument());
    expect(await screen.findByAltText(/QR code/)).toBeInTheDocument();
  });
});
