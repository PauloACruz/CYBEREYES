import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, makeMe, mockFetch, problem, renderApp } from '../../test/utils';
import { base64UrlToBuffer, bufferToBase64Url, credentialToJson } from './webauthn';

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

/** Simula um celular: tela estreita com toque. */
function phone() {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('pointer: coarse') || query.includes('max-width: 768px'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

/** Biometria do aparelho disponivel para o navegador, com create/get simulados. */
function deviceBiometrics(credentials: { create?: () => unknown; get?: () => unknown }) {
  const credentialType = Object.assign(function PublicKeyCredential() {}, {
    isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(true),
  });
  vi.stubGlobal('PublicKeyCredential', credentialType);
  const api = { create: vi.fn(credentials.create ?? (() => null)), get: vi.fn(credentials.get ?? (() => null)) };
  Object.defineProperty(navigator, 'credentials', { value: api, configurable: true });
  return api;
}

const assertion = {
  id: 'Y3JlZA',
  rawId: bytes(99, 114, 101, 100),
  type: 'public-key',
  authenticatorAttachment: 'platform',
  getClientExtensionResults: () => ({}),
  response: {
    clientDataJSON: bytes(123, 125),
    authenticatorData: bytes(1, 2, 3),
    signature: bytes(4, 5),
    userHandle: bytes(117, 49),
  },
};

const attestation = {
  id: 'Y3JlZA',
  rawId: bytes(99, 114, 101, 100),
  type: 'public-key',
  authenticatorAttachment: 'platform',
  getClientExtensionResults: () => ({}),
  response: {
    clientDataJSON: bytes(123, 125),
    attestationObject: bytes(160),
    getTransports: () => ['internal'],
  },
};

const passkey = { id: 'Y3JlZA', name: 'iPhone', createdAt: '2026-10-14T12:00:00Z', synced: true };

function bodyOf(fetchMock: ReturnType<typeof mockFetch>, method: string, path: string): unknown {
  const call = fetchMock.mock.calls.find(([input, init]) => init?.method === method && new URL(input as string, 'http://localhost').pathname === path);
  return call ? JSON.parse(call[1]?.body as string) : undefined;
}

describe('conversões do WebAuthn', () => {
  it('base64url vai e volta sem preenchimento', () => {
    for (const value of [bytes(), bytes(251), bytes(251, 255), bytes(0, 1, 2, 3, 254, 255)]) {
      const text = bufferToBase64Url(value);
      expect(text).not.toMatch(/[+/=]/);
      expect(new Uint8Array(base64UrlToBuffer(text))).toEqual(new Uint8Array(value));
    }
  });

  it('a resposta da biometria vai no formato JSON do WebAuthn', () => {
    expect(credentialToJson(assertion as unknown as PublicKeyCredential)).toEqual({
      id: 'Y3JlZA',
      rawId: 'Y3JlZA',
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: { clientDataJSON: 'e30', authenticatorData: 'AQID', signature: 'BAU', userHandle: 'dTE' },
    });
  });
});

describe('entrada por biometria', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'credentials');
  });

  it('entra com biometria e, no celular, o código fica dispensado por 30 dias', async () => {
    phone();
    localStorage.setItem('cybereyes:biometria', 'Y3JlZA');
    const device = deviceBiometrics({ get: () => assertion });
    let logged = false;
    const fetchMock = mockFetch({
      'GET /api/auth/me': () => (logged ? json(makeMe({ permissions: ['agents.view'] })) : problem(401, 'UNAUTHORIZED', 'Não autenticado')),
      'POST /api/auth/passkeys/login/options': () => json({ challenge: 'AAEC', rpId: 'rmm.exemplo.com', allowCredentials: [], userVerification: 'required' }),
      'POST /api/auth/passkeys/login': () => json({ status: 'requires2fa' }),
      'POST /api/auth/login/2fa': () => {
        logged = true;
        return json({ status: 'ok' });
      },
      'GET /api/agents': () => json({ items: [], total: 0, page: 1, pageSize: 30 }),
    });
    const { router } = renderApp('/login');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Entrar com biometria/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login/2fa'));
    const options = device.get.mock.calls[0] as unknown as [{ publicKey: PublicKeyCredentialRequestOptions }];
    expect(new Uint8Array(options[0].publicKey.challenge as ArrayBuffer)).toEqual(new Uint8Array([0, 1, 2]));
    expect(bodyOf(fetchMock, 'POST', '/api/auth/passkeys/login')).toMatchObject({
      credential: { id: 'Y3JlZA', response: { signature: 'BAU' } },
      rememberMe: false,
    });

    const remember = await screen.findByRole('checkbox', { name: 'Não pedir o código neste celular por 30 dias' });
    expect(remember).toBeChecked();
    await user.click(screen.getByLabelText('Código de verificação').querySelector('input')!);
    await user.keyboard('123456');

    await waitFor(() => expect(router.state.location.pathname).toBe('/app/agentes'));
    expect(bodyOf(fetchMock, 'POST', '/api/auth/login/2fa')).toEqual({ code: '123456', rememberMe: false, rememberDevice: true });
  });

  it('sem biometria cadastrada neste aparelho o login não oferece a opção', async () => {
    phone();
    deviceBiometrics({});
    mockFetch({ 'GET /api/auth/me': () => problem(401, 'UNAUTHORIZED', 'Não autenticado') });
    renderApp('/login');

    expect(await screen.findByLabelText(/Usuário ou e-mail/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Entrar com biometria/ })).not.toBeInTheDocument();
  });

  it('no computador o código continua sendo pedido a cada entrada', async () => {
    mockFetch({ 'GET /api/auth/me': () => problem(401, 'UNAUTHORIZED', 'Não autenticado') });
    renderApp('/login/2fa');

    expect(await screen.findByText('Verificação em duas etapas')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /30 dias/ })).not.toBeInTheDocument();
  });

  it('a aba Mais ativa a biometria do celular e mostra até quando o código fica dispensado', async () => {
    const device = deviceBiometrics({ create: () => attestation });
    let registered = false;
    const fetchMock = mockFetch({
      'GET /api/auth/me': () => json(makeMe()),
      'GET /api/auth/passkeys': () => json(registered ? [passkey] : []),
      'GET /api/auth/2fa/device': () => json({ remembered: true, expiresAt: '2026-11-13T12:00:00Z' }),
      'DELETE /api/auth/2fa/device': () => new Response(null, { status: 204 }),
      'POST /api/auth/passkeys/register/options': () =>
        json({
          rp: { id: 'rmm.exemplo.com', name: 'rmm.exemplo.com' },
          user: { id: 'dTE', name: 'tecnico', displayName: 'Maria Silva' },
          challenge: 'AAEC',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          excludeCredentials: [{ id: 'b2xk', type: 'public-key', transports: ['internal'] }],
          authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
        }),
      'POST /api/auth/passkeys/register': () => {
        registered = true;
        return json(passkey, 201);
      },
    });
    renderApp('/app/mais');
    const user = userEvent.setup();

    expect(await screen.findByText('Dispensado neste celular até 13/11/2026')).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Entrar com biometria' });
    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);

    await waitFor(() => expect(screen.getByRole('switch', { name: 'Entrar com biometria' })).toBeChecked());
    expect(screen.getByText('Ativada neste celular desde 14/10/2026')).toBeInTheDocument();
    expect(localStorage.getItem('cybereyes:biometria')).toBe('Y3JlZA');
    const options = device.create.mock.calls[0] as unknown as [{ publicKey: PublicKeyCredentialCreationOptions }];
    expect(new Uint8Array(options[0].publicKey.user.id as ArrayBuffer)).toEqual(new Uint8Array([117, 49]));
    expect(bodyOf(fetchMock, 'POST', '/api/auth/passkeys/register')).toMatchObject({
      credential: { rawId: 'Y3JlZA', response: { attestationObject: 'oA', transports: ['internal'] } },
    });

    await user.click(screen.getByRole('button', { name: 'Pedir o código de novo neste celular' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true));
  });
});
