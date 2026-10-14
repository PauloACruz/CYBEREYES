import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppServerDto, WebAppChecksDto, WebAppDetail, WebAppDto, WebAppsOverview } from '../../../api/types';
import { json, makeMe, mockFetch, renderApp } from '../../../test/utils';

function server(overrides: Partial<AppServerDto> = {}): AppServerDto {
  return {
    id: 1,
    clientId: 1,
    clientName: 'Clínica Central',
    name: 'VPS produção',
    host: '203.0.113.10',
    port: 22,
    username: 'deploy',
    authMethod: 'key',
    hasPassword: false,
    hasPrivateKey: true,
    hasPassphrase: false,
    hostKeyFingerprint: 'abc123',
    hostKeyAlgorithm: 'ssh-ed25519',
    provider: null,
    notes: null,
    lastConnectedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function app(overrides: Partial<WebAppDto> = {}): WebAppDto {
  return {
    id: 1,
    clientId: 1,
    clientName: 'Clínica Central',
    serverId: 1,
    name: 'Loja',
    environment: 'Produção',
    stack: 'Node.js',
    url: 'https://loja.exemplo.com',
    monitorEnabled: true,
    checkType: 'http',
    checkTarget: 'https://loja.exemplo.com/health',
    intervalSeconds: 60,
    status: 'up',
    statusChangedAt: null,
    lastCheckedAt: new Date().toISOString(),
    lastLatencyMs: 120,
    lastStatusCode: 200,
    lastError: null,
    sslExpiresAt: null,
    hasDeploy: false,
    uptime24h: 99.95,
    ...overrides,
  };
}

const OVERVIEW: WebAppsOverview = {
  servers: [server()],
  apps: [
    app(),
    app({ id: 2, name: 'API', status: 'down', lastError: 'Resposta HTTP 502 Bad Gateway', uptime24h: 80 }),
    app({ id: 3, name: 'Blog', serverId: null, url: 'https://blog.exemplo.com' }),
  ],
};

function detail(overrides: Partial<WebAppDetail> = {}): WebAppDetail {
  const base: Omit<WebAppDto, 'uptime24h'> & { uptime24h?: number | null } = app({ id: 2, name: 'API', status: 'down', lastError: 'Resposta HTTP 502 Bad Gateway' });
  delete base.uptime24h;
  return {
    ...base,
    server: { id: 1, name: 'VPS produção', host: '203.0.113.10', port: 22, username: 'deploy' },
    notes: null,
    method: 'GET',
    expectedStatus: '200-399',
    keyword: null,
    timeoutSeconds: 10,
    failuresBeforeAlert: 2,
    alertSeverity: 'error',
    ignoreTlsErrors: false,
    sslWarnDays: 14,
    consecutiveFailures: 3,
    deployPath: null,
    repoUrl: null,
    branch: null,
    deployScript: null,
    deployTimeoutMinutes: 10,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    lastDeploy: null,
    ...overrides,
  };
}

const CHECKS: WebAppChecksDto = {
  hours: 24,
  points: [
    { time: '2026-10-01T08:00:00Z', up: true, latencyMs: 110, failures: 0, checks: 60, error: null },
    { time: '2026-10-01T09:00:00Z', up: false, latencyMs: null, failures: 60, checks: 60, error: 'HTTP 502' },
  ],
  uptime: { h24: 95.8, d7: 99.4, d30: 99.8 },
  outages: [{ id: 5, start: '2026-10-01T09:00:00Z', end: null, resolved: false, message: 'Resposta HTTP 502 Bad Gateway' }],
};

describe('aplicações no app', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('destaca as que estão fora do ar e agrupa por servidor', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['apps.view'] })),
      'GET /api/webapps/overview': () => json(OVERVIEW),
    });
    renderApp('/app/aplicacoes');

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/API fora do ar/)).toBeInTheDocument();
    expect(alert).toHaveAttribute('href', '/app/aplicacoes/2');
    const vps = screen.getByRole('region', { name: 'VPS produção' });
    expect(within(vps).getByText('1 fora do ar')).toBeInTheDocument();
    expect(within(vps).getByText('deploy@203.0.113.10')).toBeInTheDocument();
    expect(within(vps).getByRole('link', { name: 'Loja: no ar' })).toHaveAttribute('href', '/app/aplicacoes/1');
    const external = screen.getByRole('region', { name: 'Sem servidor SSH' });
    expect(within(external).getByRole('link', { name: 'Blog: no ar' })).toBeInTheDocument();
    // A aba mostra quantas estao fora do ar.
    expect(within(screen.getByRole('navigation', { name: 'Navegação do app' })).getByLabelText('1 fora do ar')).toBeInTheDocument();
  });

  it('mostra a disponibilidade, as quedas e verifica de novo', async () => {
    let checked = false;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['apps.view'] })),
      'GET /api/webapps/overview': () => json(OVERVIEW),
      'GET /api/webapps/2': () => json(detail()),
      'GET /api/webapps/2/checks': () => json(CHECKS),
      'POST /api/webapps/2/check': () => {
        checked = true;
        return json({ up: false, statusCode: 502, latencyMs: null, error: 'HTTP 502' });
      },
    });
    renderApp('/app/aplicacoes/2');
    const user = userEvent.setup();

    expect(await screen.findByText('95,8%')).toBeInTheDocument();
    expect(screen.getByText('99,4%')).toBeInTheDocument();
    expect(screen.getAllByText('Resposta HTTP 502 Bad Gateway').length).toBeGreaterThan(0);
    expect(screen.getByText('Ainda fora do ar')).toBeInTheDocument();
    expect(screen.getByText('deploy@203.0.113.10')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Abrir o site/ })).toHaveAttribute('href', 'https://loja.exemplo.com');

    await user.click(screen.getByRole('button', { name: 'Verificar agora' }));
    await waitFor(() => expect(checked).toBe(true));
  });
});
