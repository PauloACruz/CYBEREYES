import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockFetch, problem, renderApp } from '../../test/utils';

const UID = '3f2a1c4e-0000-4000-8000-000000000001';

function bodyOf(fetchMock: ReturnType<typeof mockFetch>, method: string, path: string): unknown {
  const call = fetchMock.mock.calls.find(([input, init]) => init?.method === method && String(input).includes(path));
  return JSON.parse(call?.[1]?.body as string);
}

describe('esqueci minha senha', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('o login leva a tela de recuperacao, que confirma sem revelar se a conta existe', async () => {
    const fetchMock = mockFetch({ 'POST /api/auth/password/forgot': () => new Response(null, { status: 202 }) });
    const { router } = renderApp('/login');
    const user = userEvent.setup();

    await user.click(screen.getByRole('link', { name: 'Esqueci minha senha' }));
    expect(router.state.location.pathname).toBe('/esqueci-senha');
    await user.type(screen.getByLabelText(/Usuário ou e-mail/), ' maria@exemplo.com ');
    await user.click(screen.getByRole('button', { name: 'Enviar link' }));

    expect(await screen.findByRole('heading', { name: 'Verifique seu e-mail' })).toBeInTheDocument();
    expect(screen.getByText(/Se existir uma conta ativa/)).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST', '/api/auth/password/forgot')).toEqual({ login: 'maria@exemplo.com' });
  });
});

describe('redefinir senha pelo link', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('envia uid, token e a nova senha e confirma', async () => {
    const fetchMock = mockFetch({ 'POST /api/auth/password/reset': () => new Response(null, { status: 204 }) });
    renderApp(`/redefinir-senha?uid=${UID}&token=abc%2B123`);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^Nova senha/), 'uma-senha-nova-longa');
    await user.type(screen.getByLabelText(/Confirmar nova senha/), 'uma-senha-nova-longa');
    await user.click(screen.getByRole('button', { name: 'Salvar nova senha' }));

    expect(await screen.findByRole('heading', { name: 'Senha redefinida' })).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST', '/api/auth/password/reset')).toEqual({ userId: UID, token: 'abc+123', newPassword: 'uma-senha-nova-longa' });
  });

  it('confirmacao diferente nao envia', async () => {
    const fetchMock = mockFetch({});
    renderApp(`/redefinir-senha?uid=${UID}&token=abc`);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^Nova senha/), 'uma-senha-nova-longa');
    await user.type(screen.getByLabelText(/Confirmar nova senha/), 'outra-coisa');
    await user.click(screen.getByRole('button', { name: 'Salvar nova senha' }));

    expect(await screen.findByText('As senhas não conferem')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('link expirado oferece pedir outro', async () => {
    mockFetch({ 'POST /api/auth/password/reset': () => problem(400, 'INVALID_TOKEN', 'Link invalido ou expirado; peca um novo') });
    renderApp(`/redefinir-senha?uid=${UID}&token=velho`);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^Nova senha/), 'uma-senha-nova-longa');
    await user.type(screen.getByLabelText(/Confirmar nova senha/), 'uma-senha-nova-longa');
    await user.click(screen.getByRole('button', { name: 'Salvar nova senha' }));

    expect(await screen.findByRole('heading', { name: 'Link inválido' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pedir novo link' })).toHaveAttribute('href', '/esqueci-senha');
  });

  it('link sem token nem chama a API', () => {
    const fetchMock = mockFetch({});
    renderApp('/redefinir-senha');

    expect(screen.getByText(/O link está incompleto/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('aceitar convite', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra o usuario, cria a senha e orienta o primeiro login com 2FA', async () => {
    const fetchMock = mockFetch({
      'GET /api/auth/invite': () => json({ username: 'joao.tecnico', fullName: 'João Souza' }),
      'POST /api/auth/invite/accept': () => new Response(null, { status: 204 }),
    });
    renderApp(`/convite?uid=${UID}&token=tok`);
    const user = userEvent.setup();

    expect(await screen.findByText(/Olá, João Souza/)).toBeInTheDocument();
    expect(screen.getByText('joao.tecnico')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Senha/), 'minha-senha-de-convite');
    await user.type(screen.getByLabelText(/Confirmar senha/), 'minha-senha-de-convite');
    await user.click(screen.getByRole('button', { name: 'Criar senha' }));

    expect(await screen.findByRole('heading', { name: 'Senha criada' })).toBeInTheDocument();
    expect(screen.getByText(/verificação em duas etapas/)).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST', '/api/auth/invite/accept')).toEqual({ userId: UID, token: 'tok', password: 'minha-senha-de-convite' });
  });

  it('convite expirado ou usado mostra o motivo', async () => {
    mockFetch({ 'GET /api/auth/invite': () => problem(400, 'INVALID_TOKEN', 'Este convite ja foi usado; entre com seu usuario e senha') });
    renderApp(`/convite?uid=${UID}&token=tok`);

    expect(await screen.findByRole('heading', { name: 'Convite inválido' })).toBeInTheDocument();
    expect(screen.getByText(/Este convite ja foi usado/)).toBeInTheDocument();
  });
});
