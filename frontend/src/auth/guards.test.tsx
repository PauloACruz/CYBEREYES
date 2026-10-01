import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, makeMe, mockFetch, problem, renderApp } from '../test/utils';

const emptyAudit = { items: [], total: 0, page: 1, pageSize: 50 };

describe('guarda de rotas por permissao', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('bloqueia a rota sem a permissao e esconde o item do menu', async () => {
    mockFetch({ 'GET /api/auth/me': () => json(makeMe({ permissions: ['users.view'] })) });
    renderApp('/auditoria');

    expect(await screen.findByRole('heading', { name: 'Acesso negado' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
    expect(within(nav).getByText('Usuários')).toBeInTheDocument();
    expect(within(nav).queryByText('Auditoria')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Papéis')).not.toBeInTheDocument();
  });

  it('libera a rota com a permissao', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['audit.view'] })),
      'GET /api/audit': () => json(emptyAudit),
    });
    renderApp('/auditoria');

    expect(await screen.findByRole('heading', { name: 'Auditoria' })).toBeInTheDocument();
    expect(await screen.findByText('Nenhum registro de auditoria.')).toBeInTheDocument();
  });

  it('superusuario ve todos os itens do menu', async () => {
    mockFetch({ 'GET /api/auth/me': () => json(makeMe({ isSuperuser: true })) });
    renderApp('/');

    const nav = await screen.findByRole('navigation', { name: 'Navegação principal' });
    for (const label of ['Painel', 'Usuários', 'Papéis', 'Chaves de API', 'Auditoria']) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
  });

  it('sessao sem 2FA validado e redirecionada', async () => {
    mockFetch({ 'GET /api/auth/me': () => json(makeMe({ twoFactorEnabled: true, mfaSatisfied: false })) });
    const { router } = renderApp('/usuarios');

    expect(await screen.findByRole('heading', { name: 'Verificação em duas etapas' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login/2fa');
  });

  it('sem sessao (401) vai ao login', async () => {
    mockFetch({ 'GET /api/auth/me': () => problem(401, 'UNAUTHENTICATED', 'Nao autenticado') });
    const { router } = renderApp('/papeis');

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });
});
