import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, makeMe, mockFetch, problem, renderApp } from '../../test/utils';
import { deviceName } from './pushClient';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/aparelho-1';
// Chave publica P-256 qualquer em base64url (65 bytes): o servidor real gera a dele.
const SERVER_KEY = `BA${'A'.repeat(85)}`;

/** Navegador com service worker e PushManager simulados; a inscricao so existe depois do subscribe. */
function pushBrowser(permission: NotificationPermission = 'default') {
  let subscription: PushSubscription | null = null;
  const requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>('granted'));
  const subscribe = vi.fn((options: PushSubscriptionOptionsInit) => {
    subscription = {
      endpoint: ENDPOINT,
      options: { applicationServerKey: (options.applicationServerKey as Uint8Array).buffer },
      toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'chave-do-aparelho', auth: 'segredo' } }),
      unsubscribe: vi.fn(() => {
        subscription = null;
        return Promise.resolve(true);
      }),
    } as unknown as PushSubscription;
    return Promise.resolve(subscription);
  });
  const registration = { pushManager: { getSubscription: () => Promise.resolve(subscription), subscribe } };
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission, requestPermission }));
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: () => Promise.resolve(registration), ready: Promise.resolve(registration) },
  });
  return { requestPermission, subscribe };
}

describe('notificações de chamados', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('ativa neste aparelho pelo app, escolhe os avisos e envia um teste', async () => {
    const browser = pushBrowser();
    const saved: unknown[] = [];
    let registered = false;
    let preferences = { newTickets: true, updates: true, messages: true };
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['tickets.view'] })),
      'GET /api/push/config': () => json({ publicKey: SERVER_KEY }),
      'POST /api/push/subscription/find': () =>
        registered ? json({ endpoint: ENDPOINT, device: 'Chrome', ...preferences, createdAt: '2026-10-14T12:00:00Z', lastSentAt: null }) : problem(404, 'NOT_FOUND', 'Inscricao nao encontrado'),
      'PUT /api/push/subscription': (init) => {
        const body = JSON.parse(init?.body as string) as typeof preferences;
        saved.push(body);
        registered = true;
        preferences = { newTickets: body.newTickets, updates: body.updates, messages: body.messages };
        return json({ endpoint: ENDPOINT, device: 'Chrome', ...preferences, createdAt: '2026-10-14T12:00:00Z', lastSentAt: null });
      },
      'POST /api/push/test': () => json({ delivered: true, error: null }),
    });
    renderApp('/app/mais');
    const user = userEvent.setup();

    const main = await screen.findByRole('switch', { name: /Notificações neste aparelho/ });
    expect(main).not.toBeChecked();
    expect(screen.queryByRole('switch', { name: /Mensagens/ })).not.toBeInTheDocument();
    await user.click(main);

    await waitFor(() => expect(screen.getByRole('switch', { name: /Notificações neste aparelho/ })).toBeChecked());
    expect(browser.requestPermission).toHaveBeenCalled();
    expect(browser.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(saved[0]).toMatchObject({ endpoint: ENDPOINT, p256dh: 'chave-do-aparelho', auth: 'segredo', newTickets: true, updates: true, messages: true });

    await user.click(screen.getByRole('switch', { name: /Mensagens/ }));
    await waitFor(() => expect(saved[1]).toMatchObject({ endpoint: ENDPOINT, messages: false, newTickets: true }));
    await waitFor(() => expect(screen.getByRole('switch', { name: /Mensagens/ })).not.toBeChecked());

    await user.click(screen.getByRole('button', { name: /Enviar notificação de teste/ }));
    expect(await screen.findByText('A notificação de teste deve aparecer em alguns segundos.')).toBeInTheDocument();
  });

  it('com as notificações bloqueadas no navegador, explica como liberar', async () => {
    pushBrowser('denied');
    mockFetch({ 'GET /api/auth/me': () => json(makeMe({ permissions: ['tickets.view'] })) });
    renderApp('/app/mais');

    expect(await screen.findByText(/Bloqueadas no navegador/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Notificações neste aparelho/ })).toBeDisabled();
  });

  it('no iPhone sem o app instalado, pede para instalar', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1');
    mockFetch({ 'GET /api/auth/me': () => json(makeMe({ permissions: ['tickets.view'] })) });
    renderApp('/app/mais');

    expect(await screen.findByText(/Adicionar à Tela de Início/)).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('sem permissão de chamados, o app não mostra a seção', async () => {
    mockFetch({ 'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view'] })) });
    renderApp('/app/mais');

    expect(await screen.findByText('Maria Silva')).toBeInTheDocument();
    expect(screen.queryByText('Notificações')).not.toBeInTheDocument();
  });

  it('o console abre as notificações pelo menu do usuário', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['tickets.view'] })),
      'GET /api/dashboard/overview': () => json({ from: '2026-10-08', to: '2026-10-14', agents: null, tickets: null, checks: null }),
    });
    renderApp('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Menu do usuário' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Notificações' }));

    expect(await screen.findByRole('dialog', { name: 'Notificações' })).toBeInTheDocument();
    expect(screen.getByText('Este navegador não recebe notificações.')).toBeInTheDocument();
  });

  it('dá nome ao aparelho pelo navegador e sistema', () => {
    expect(deviceName('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36')).toBe('Chrome no Android');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('Edge no Windows');
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1')).toBe(
      'Safari no iPhone',
    );
    expect(deviceName('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox no Linux');
  });
});
