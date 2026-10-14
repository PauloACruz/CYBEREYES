import { pushApi } from '../../api/push';
import type { PushPreferences, PushSubscriptionDto } from '../../api/types';

/**
 * Onde o Web Push funciona: precisa de HTTPS, do service worker publicado (so no build de producao) e, no iPhone,
 * do app instalado na tela de inicio (iOS 16.4 ou mais novo).
 */
export type PushSupport = 'supported' | 'unsupported' | 'needs-install';

function standalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

export function pushSupport(): PushSupport {
  if (window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'supported';
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !standalone()) return 'needs-install';
  return 'unsupported';
}

export function notificationPermission(): NotificationPermission {
  return 'Notification' in window ? Notification.permission : 'denied';
}

/** Chaves deste aparelho no servico de push, como o servidor recebe. */
export interface DeviceSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushDevice {
  /** Sem service worker (ambiente de desenvolvimento ou registro bloqueado): nao ha como receber. */
  worker: boolean;
  subscription: DeviceSubscription | null;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!(await navigator.serviceWorker.getRegistration())) return null;
  return navigator.serviceWorker.ready;
}

function toDevice(subscription: PushSubscription): DeviceSubscription | null {
  const keys = subscription.toJSON().keys;
  return keys?.p256dh && keys.auth ? { endpoint: subscription.endpoint, p256dh: keys.p256dh, auth: keys.auth } : null;
}

export async function pushDevice(): Promise<PushDevice> {
  const reg = await registration();
  if (!reg) return { worker: false, subscription: null };
  const subscription = await reg.pushManager.getSubscription();
  return { worker: true, subscription: subscription ? toDevice(subscription) : null };
}

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sameKey(current: ArrayBuffer | null, publicKey: string): boolean {
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = base64UrlBytes(publicKey);
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Nome curto do aparelho para a lista do usuario ("Chrome no Android"). */
export function deviceName(userAgent = navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /SamsungBrowser/.test(userAgent)
      ? 'Samsung Internet'
      : /Firefox|FxiOS/.test(userAgent)
        ? 'Firefox'
        : /Chrome|CriOS/.test(userAgent)
          ? 'Chrome'
          : /Safari/.test(userAgent)
            ? 'Safari'
            : 'Navegador';
  const system = /Android/.test(userAgent)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(userAgent)
      ? 'iPhone'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return system ? `${browser} no ${system}` : browser;
}

export class PushBlockedError extends Error {
  constructor() {
    super('Notificações bloqueadas neste navegador');
    this.name = 'PushBlockedError';
  }
}

/**
 * Liga as notificacoes neste aparelho. O pedido de permissao e feito pelo chamador, direto no toque do usuario
 * (o Safari recusa o pedido fora do gesto), e chega aqui ja em andamento.
 */
export async function enablePush(permission: Promise<NotificationPermission>, preferences: PushPreferences): Promise<PushSubscriptionDto> {
  if ((await permission) !== 'granted') throw new PushBlockedError();
  const reg = await registration();
  if (!reg) throw new Error('Service worker indisponível');
  const { publicKey } = await pushApi.config();
  let subscription = await reg.pushManager.getSubscription();
  // Inscricao feita com outra chave do servidor nao recebe mais nada: troca por uma nova.
  if (subscription && !sameKey(subscription.options.applicationServerKey, publicKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlBytes(publicKey) });
  const device = toDevice(subscription);
  if (!device) throw new Error('O navegador não entregou as chaves da inscrição');
  return pushApi.save({ ...device, device: deviceName(), ...preferences });
}

export function savePreferences(device: DeviceSubscription, preferences: PushPreferences): Promise<PushSubscriptionDto> {
  return pushApi.save({ ...device, device: deviceName(), ...preferences });
}

/** Desliga neste aparelho: o servidor esquece a inscricao e o navegador cancela no servico de push. */
export async function disablePush(): Promise<void> {
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  await pushApi.remove(subscription.endpoint);
  await subscription.unsubscribe();
}

/** Ao sair da conta: os avisos deste usuario param de chegar neste aparelho (outra pessoa pode entrar nele). */
export async function forgetPushOnLogout(): Promise<void> {
  try {
    if (pushSupport() !== 'supported') return;
    const device = await pushDevice();
    if (device.subscription) await pushApi.remove(device.subscription.endpoint, { silent: true });
  } catch {
    // Sem rede ou sem service worker: o logout continua.
  }
}
