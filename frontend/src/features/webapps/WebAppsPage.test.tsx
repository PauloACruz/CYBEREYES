import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppRunDetail, AppServerDto, SaveAppServerRequest, WebAppDto, WebAppsOverview } from '../../api/types';
import { CLIENTS } from '../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

const KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\n-----END OPENSSH PRIVATE KEY-----';

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
    provider: 'Hostinger',
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
    hasDeploy: true,
    uptime24h: 99.95,
    ...overrides,
  };
}

const OVERVIEW: WebAppsOverview = {
  servers: [server(), server({ id: 2, name: 'VPS homologação', host: '203.0.113.20', port: 2222 })],
  apps: [
    app(),
    app({ id: 2, name: 'API', status: 'down', lastError: 'Resposta HTTP 502 Bad Gateway', uptime24h: 80, hasDeploy: false }),
    app({ id: 3, name: 'Blog', serverId: null, hasDeploy: false, url: 'https://blog.exemplo.com' }),
  ],
};

function run(overrides: Partial<AppRunDetail> = {}): AppRunDetail {
  return {
    id: 77,
    serverId: 1,
    serverName: 'VPS produção',
    webAppId: 1,
    webAppName: 'Loja',
    commandId: null,
    kind: 'deploy',
    title: 'Deploy de Loja',
    status: 'success',
    exitCode: 0,
    error: null,
    startedBy: 'Maria Silva',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    script: 'git pull',
    output: 'Already up to date.\n',
    outputTruncated: false,
    cancelRequested: false,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Abre o Select e escolhe a opcao na lista ligada a ele (a pagina tem outro Select com as mesmas opcoes). */
async function pick(user: ReturnType<typeof userEvent.setup>, combobox: HTMLElement, option: string) {
  await user.click(combobox);
  const listbox = await waitFor(() => {
    const el = document.getElementById(combobox.getAttribute('aria-controls') ?? '');
    if (!el) throw new Error('lista não aberta');
    return el;
  });
  await user.click(await within(listbox).findByRole('option', { name: option, hidden: true }));
}

describe('página de aplicações', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('agrupa as aplicações por servidor, mostra as externas à parte e filtra as que estão fora do ar', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['apps.view', 'clients.view'] })),
      'GET /api/clients': () => json(CLIENTS),
      'GET /api/webapps/overview': () => json(OVERVIEW),
    });
    renderApp('/aplicacoes');
    const user = userEvent.setup();

    expect(await screen.findByRole('link', { name: 'VPS produção' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Aplicações' })).toBeInTheDocument();
    expect(screen.getByText('deploy@203.0.113.20:2222')).toBeInTheDocument();
    expect(screen.getByText('Sem servidor SSH')).toBeInTheDocument();
    expect(screen.getByText('1 fora do ar')).toBeInTheDocument();
    expect(screen.getByText('Resposta HTTP 502 Bad Gateway')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma aplicação neste servidor.')).toBeInTheDocument();
    // Sem apps.run e sem apps.manage: nada de deploy nem cadastro.
    expect(screen.queryByRole('button', { name: /Deploy de/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Novo servidor' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Fora do ar' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Loja' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'API' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'VPS homologação' })).not.toBeInTheDocument();
    expect(screen.queryByText('Sem servidor SSH')).not.toBeInTheDocument();
  });

  it('faz deploy com confirmação e mostra a saída', async () => {
    let deployed = false;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['apps.view', 'apps.run'] })),
      'GET /api/webapps/overview': () => json(OVERVIEW),
      'POST /api/webapps/1/deploy': () => {
        deployed = true;
        return json({ id: 77, status: 'running' }, 202);
      },
      'GET /api/webapps/runs/77': () => json(run()),
    });
    renderApp('/aplicacoes');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Deploy de Loja' }));
    await user.click(await screen.findByRole('button', { name: 'Fazer deploy' }));
    const dialog = await screen.findByRole('dialog', { name: 'Deploy' });
    expect(await within(dialog).findByText(/Already up to date/)).toBeInTheDocument();
    expect(within(dialog).getByText('Concluído')).toBeInTheDocument();
    expect(deployed).toBe(true);
  });

  it('testa a conexão SSH antes de salvar e fixa a chave vista no teste', async () => {
    let tested: SaveAppServerRequest | undefined;
    let saved: SaveAppServerRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['apps.view', 'apps.manage', 'clients.view'] })),
      'GET /api/clients': () => json(CLIENTS),
      'GET /api/webapps/overview': () => json({ servers: [], apps: [] }),
      'POST /api/webapps/servers/test': (init) => {
        tested = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as SaveAppServerRequest;
        return json({ ok: true, error: null, code: null, fingerprint: 'nova-chave', algorithm: 'ssh-ed25519', system: 'Linux 6.8 x86_64\nUbuntu 24.04', pinned: false });
      },
      'POST /api/webapps/servers': (init) => {
        saved = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as SaveAppServerRequest;
        return json(server({ id: 5, name: 'VPS nova' }), 201);
      },
      'GET /api/webapps/servers/5': () => json(server({ id: 5, name: 'VPS nova' })),
    });
    renderApp('/aplicacoes');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Novo servidor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo servidor' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Nome' }), 'VPS nova');
    await pick(user, within(dialog).getByRole('combobox', { name: 'Cliente' }), 'Clínica Central');
    await user.type(within(dialog).getByRole('textbox', { name: 'IP ou nome do servidor' }), '198.51.100.7');
    await user.clear(within(dialog).getByRole('textbox', { name: 'Usuário SSH' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Usuário SSH' }), 'deploy');
    await user.click(within(dialog).getByRole('textbox', { name: /Chave privada/ }));
    await user.paste(KEY);

    await user.click(within(dialog).getByRole('button', { name: 'Testar conexão' }));
    expect(await within(dialog).findByText('Conexão bem-sucedida')).toBeInTheDocument();
    expect(within(dialog).getByText('SHA256:nova-chave')).toBeInTheDocument();
    expect(tested).toMatchObject({ host: '198.51.100.7', port: 22, username: 'deploy', authMethod: 'key', privateKey: KEY });
    expect(tested?.password).toBeUndefined();

    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar servidor' }));
    await waitFor(() => expect(saved).toMatchObject({ name: 'VPS nova', hostKeyFingerprint: 'nova-chave' }));
    expect(await screen.findByRole('heading', { name: 'VPS nova' })).toBeInTheDocument();
  });
});
