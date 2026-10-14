import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberReturnPath, takeReturnPath } from '../../auth/returnPath';
import { makeAgent } from '../../test/fixtures';
import { json, makeMe, mockFetch, problem, renderApp } from '../../test/utils';

const agentsList = () => json({ items: [makeAgent()], total: 1, page: 1, pageSize: 30 });

describe('app do técnico', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('abre na primeira área permitida e mostra só as abas do papel', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view'] })),
      'GET /api/agents': agentsList,
    });
    const { router } = renderApp('/app');

    await waitFor(() => expect(router.state.location.pathname).toBe('/app/agentes'));
    const nav = await screen.findByRole('navigation', { name: 'Navegação do app' });
    expect(within(nav).getByRole('link', { name: /Agentes/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: /Mais/ })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: /Chamados/ })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: /Aplicações/ })).not.toBeInTheDocument();
  });

  it('a aba Mais leva ao console completo e troca o tema', async () => {
    mockFetch({ 'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view'] })) });
    renderApp('/app/mais');
    const user = userEvent.setup();

    expect(await screen.findByText('Maria Silva')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Abrir o console completo/ })).toHaveAttribute('href', '/');
    const theme = screen.getByRole('button', { name: /Usar tema (claro|escuro)/ });
    const before = theme.textContent;
    await user.click(theme);
    await waitFor(() => expect(screen.getByRole('button', { name: /Usar tema (claro|escuro)/ }).textContent).not.toBe(before));
  });

  it('volta para a tela do app depois do login', async () => {
    let logged = false;
    mockFetch({
      'GET /api/auth/me': () => (logged ? json(makeMe({ permissions: ['agents.view'] })) : problem(401, 'UNAUTHORIZED', 'Não autenticado')),
      'POST /api/auth/login': () => {
        logged = true;
        return json({ status: 'ok' });
      },
      'GET /api/agents': agentsList,
    });
    const { router } = renderApp('/app/agentes?status=online');

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Usuário/), 'tecnico');
    await user.type(screen.getByLabelText(/Senha/), 'segredo123');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/app/agentes'));
    expect(router.state.location.search).toBe('?status=online');
    expect(await screen.findByRole('link', { name: /PC-RECEPCAO/ })).toBeInTheDocument();
  });
});

/** Simula um celular: tela estreita com toque; com `wide`, o modo "versao para computador" (janela larga). */
function phone({ wide = false }: { wide?: boolean } = {}) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('pointer: coarse') || (!wide && query.includes('max-width: 768px')),
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

describe('app do técnico no celular', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a página inicial abre o app no celular, e o console quando o técnico escolheu', async () => {
    phone();
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view'] })),
      'GET /api/agents': agentsList,
      'GET /api/dashboard/overview': () => json({ from: '2026-10-08', to: '2026-10-14', agents: null, tickets: null, checks: null }),
    });
    const first = renderApp('/');
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/app/agentes'));
    first.unmount();

    localStorage.setItem('cybereyes:console-no-celular', '1');
    const second = renderApp('/');
    expect(await screen.findByRole('heading', { name: /Olá, Maria/ })).toBeInTheDocument();
    expect(second.router.state.location.pathname).toBe('/');
  });

  it('agentes, chamados e aplicações abertos pelo endereço do console vão para o app', async () => {
    phone();
    mockFetch({ 'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view', 'tickets.view', 'apps.view'] })) });
    for (const [from, to] of [
      ['/agentes', '/app/agentes'],
      ['/agentes/7', '/app/agentes/7'],
      ['/chamados/101', '/app/chamados/101'],
      ['/aplicacoes', '/app/aplicacoes'],
    ] as const) {
      const { router, unmount } = renderApp(from);
      await waitFor(() => expect(router.state.location.pathname).toBe(to));
      unmount();
    }
  });

  it('no celular, abas do console e a escolha pelo console completo ficam no console', async () => {
    phone();
    mockFetch({ 'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view'] })) });
    const files = renderApp('/agentes/7?aba=arquivos');
    expect(await screen.findByRole('button', { name: 'Menu do usuário' })).toBeInTheDocument();
    expect(files.router.state.location.pathname).toBe('/agentes/7');
    files.unmount();

    localStorage.setItem('cybereyes:console-no-celular', '1');
    const list = renderApp('/agentes');
    expect(await screen.findByRole('button', { name: 'Menu do usuário' })).toBeInTheDocument();
    expect(list.router.state.location.pathname).toBe('/agentes');
  });

  it('no modo "versão para computador" do celular a página inicial também abre o app', async () => {
    phone({ wide: true });
    vi.stubGlobal('screen', { width: 412, height: 915 });
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view'] })),
      'GET /api/agents': agentsList,
    });
    const { router } = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/agentes'));
  });

  it('o console leva de volta ao app pelo menu do usuário', async () => {
    localStorage.setItem('cybereyes:console-no-celular', '1');
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view'] })),
      'GET /api/agents': agentsList,
      'GET /api/dashboard/overview': () => json({ from: '2026-10-08', to: '2026-10-14', agents: null, tickets: null, checks: null }),
    });
    const { router } = renderApp('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Menu do usuário' }));
    await user.click(await screen.findByRole('menuitem', { name: 'App do técnico' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/agentes'));
    expect(localStorage.getItem('cybereyes:console-no-celular')).toBeNull();
  });

  it('no celular o login aparece como a entrada do app', async () => {
    phone();
    mockFetch({ 'GET /api/auth/me': () => problem(401, 'UNAUTHORIZED', 'Não autenticado') });
    renderApp('/login');

    expect(await screen.findByText('App do técnico')).toBeInTheDocument();
    expect(screen.getByText(/o app pede o código do autenticador/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Usuário ou e-mail/)).toBeInTheDocument();
    expect(screen.queryByText('Acesse o console com seu usuário e senha.')).not.toBeInTheDocument();
  });

  it('no computador o login continua o do console', async () => {
    mockFetch({ 'GET /api/auth/me': () => problem(401, 'UNAUTHORIZED', 'Não autenticado') });
    renderApp('/login');

    expect(await screen.findByText('Acesse o console com seu usuário e senha.')).toBeInTheDocument();
    expect(screen.queryByText('App do técnico')).not.toBeInTheDocument();
  });
});

describe('caminho de volta depois do login', () => {
  beforeEach(() => sessionStorage.clear());

  it('guarda só caminhos do app e lê uma vez', () => {
    rememberReturnPath('/app/chamados/101');
    expect(takeReturnPath()).toBe('/app/chamados/101');
    expect(takeReturnPath()).toBe('/');
  });

  it('ignora caminhos fora do app', () => {
    for (const path of ['/agentes', '/application', '//evil.example.com', 'https://evil.example.com/app']) {
      rememberReturnPath(path);
      expect(takeReturnPath()).toBe('/');
    }
  });

  it('descarta valor adulterado no armazenamento', () => {
    sessionStorage.setItem('cybereyes:voltar-para', '//evil.example.com');
    expect(takeReturnPath()).toBe('/');
  });
});
