/* Ledger Wallet — service worker for system notifications */
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

// Allow the page to ask the SW to display a notification (needed on iOS PWA)
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data && data.type === 'show-notification') {
    const { title, body, tag } = data;
    event.waitUntil(
      self.registration.showNotification(title || 'Ledger Wallet', {
        body: body || '',
        icon: '/assets/ledger.png',
        badge: '/assets/ledger.png',
        tag: tag || ('ledger-' + Date.now()),
        renotify: true,
        silent: false,
        data: { url: '/' }
      })
    );
  }
});

// Real Web Push (when a server delivers a push)
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {
    try { payload = { title: 'Ledger Wallet', body: event.data && event.data.text() }; } catch (__) {}
  }
  const title = payload.title || 'Ledger Wallet';
  const opts = {
    body: payload.body || '',
    icon: '/assets/ledger.png',
    badge: '/assets/ledger.png',
    tag: payload.tag || ('ledger-' + Date.now()),
    renotify: true,
    data: payload.data || { url: '/' }
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
