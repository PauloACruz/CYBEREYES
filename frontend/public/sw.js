/*
 * Service worker do app do tecnico (PWA). Nao guarda dados da API nem telas:
 * tudo vem da rede. So mantem uma pagina de "sem conexao" para quando a
 * navegacao falhar, o que tambem permite instalar o app no celular, e mostra
 * as notificacoes de chamados (Web Push) enviadas pelo servidor.
 */
const CACHE = 'cybereyes-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});

// Aviso do servidor: { title, body, url, tag }. A etiqueta do chamado troca o aviso anterior dele.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'CYBEREYES';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: '/app-icon-192.png',
      badge: '/app-icon-192.png',
      lang: 'pt-BR',
      data: { url: data.url || '/' },
    }),
  );
});

// Toque no aviso: usa uma janela do console ou do app ja aberta, ou abre uma nova, na tela do chamado.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // A janela do acesso remoto nao e trocada: perderia a sessao.
      const usable = windows.filter((client) => {
        const page = new URL(client.url);
        return page.origin === self.location.origin && !page.pathname.startsWith('/acesso-remoto');
      });
      const open = usable.find((client) => client.focused) || usable[0];
      if (!open) return self.clients.openWindow(url);
      return open
        .focus()
        .then((client) => client.navigate(url))
        .catch(() => self.clients.openWindow(url));
    }),
  );
});
