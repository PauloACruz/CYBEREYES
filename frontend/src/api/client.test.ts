import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, configureApiClient, request } from './client';
import { json, mockFetch, problem } from '../test/utils';

describe('cliente HTTP', () => {
  const onUnauthorized = vi.fn();
  const onMfaRequired = vi.fn();
  const onError = vi.fn();

  beforeEach(() => {
    configureApiClient({ onUnauthorized, onMfaRequired, onError });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    configureApiClient({});
  });

  it('401 UNAUTHENTICATED leva ao login sem notificar', async () => {
    mockFetch({ 'GET /api/users': () => problem(401, 'UNAUTHENTICATED', 'Não autenticado') });

    const error = await request('/api/users').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('401 INVALID_CREDENTIALS notifica com o title e nao redireciona', async () => {
    mockFetch({ 'POST /api/auth/login': () => problem(401, 'INVALID_CREDENTIALS', 'Credenciais invalidas') });

    await expect(request('/api/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      title: 'Credenciais invalidas',
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ title: 'Credenciais invalidas' }));
  });

  it('403 MFA_REQUIRED leva a configuracao de 2FA', async () => {
    mockFetch({ 'GET /api/roles': () => problem(403, 'MFA_REQUIRED', '2FA obrigatorio') });

    await expect(request('/api/roles')).rejects.toMatchObject({ status: 403, code: 'MFA_REQUIRED' });
    expect(onMfaRequired).toHaveBeenCalledOnce();
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('403 FORBIDDEN mostra notificacao com o title', async () => {
    mockFetch({ 'DELETE /api/roles/1': () => problem(403, 'FORBIDDEN', 'Sem permissao') });

    await expect(request('/api/roles/1', { method: 'DELETE' })).rejects.toBeInstanceOf(ApiError);
    expect(onMfaRequired).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ status: 403, title: 'Sem permissao' }));
  });

  it('expoe erros de validacao e respeita silent', async () => {
    mockFetch({
      'POST /api/users': () =>
        json({ title: 'Dados invalidos', status: 400, code: 'VALIDATION_ERROR', errors: { email: ['E-mail invalido'] } }, 400),
    });

    const error = await request('/api/users', { method: 'POST', body: {}, silent: true }).catch((e: unknown) => e);

    expect((error as ApiError).fieldErrors).toEqual({ email: ['E-mail invalido'] });
    expect(onError).not.toHaveBeenCalled();
  });

  it('envia credenciais da mesma origem, query string e corpo JSON; 204 resolve sem corpo', async () => {
    const fetchMock = mockFetch({
      'GET /api/audit': () => json({ items: [], total: 0, page: 2, pageSize: 50 }),
      'POST /api/auth/logout': () => new Response(null, { status: 204 }),
    });

    await request('/api/audit', { query: { page: 2, pageSize: 50, username: '', action: undefined } });
    await expect(request('/api/auth/logout', { method: 'POST' })).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/audit?page=2&pageSize=50');
    expect(init?.credentials).toBe('same-origin');
  });
});
