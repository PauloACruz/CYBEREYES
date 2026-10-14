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
    await user.type(screen.getByLabelText(/Usuário/), 'tecnico');
    await user.type(screen.getByLabelText(/Senha/), 'segredo123');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/app/agentes'));
    expect(router.state.location.search).toBe('?status=online');
    expect(await screen.findByRole('link', { name: /PC-RECEPCAO/ })).toBeInTheDocument();
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
