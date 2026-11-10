// AKB48 THEATER ALERT service worker：プッシュ通知の表示とタップ時の遷移
const VERSION = 'v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'AKB48 THEATER ALERT', body: event.data && event.data.text() }; }
  const opts = {
    body: d.body || '',
    tag: d.tag,
    renotify: !!d.tag,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    data: { url: d.url || './', apply: d.apply || null },
    timestamp: Date.now(),
  };
  // Android等ではボタンを出す（iPhoneはボタン非対応なので本文タップのみ）
  if (d.apply && 'actions' in Notification.prototype) {
    opts.actions = [{ action: 'apply', title: '申し込む' }, { action: 'open', title: '詳しく見る' }];
  }
  event.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'AKB48 THEATER ALERT', opts);
    if (navigator.setAppBadge) {
      const list = await self.registration.getNotifications();
      navigator.setAppBadge(list.length).catch(() => {});
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url, apply } = event.notification.data || {};
  const target = event.action === 'apply' && apply ? apply : new URL(url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
    if (target.startsWith(self.registration.scope)) {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if (w.url.startsWith(self.registration.scope) && 'focus' in w) {
          await w.focus();
          w.postMessage({ type: 'navigate', url: target });
          return;
        }
      }
    }
    await self.clients.openWindow(target);
  })());
});

// 購読情報がブラウザ側で更新されたら、サーバーにも登録し直す
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const cfg = await (await fetch('data/config.json', { cache: 'no-cache' })).json();
    const cache = await caches.open('oshi-alert-prefs');
    const saved = await cache.match('members');
    const members = saved ? await saved.json() : [];
    if (!cfg.apiBase || !cfg.vapidPublicKey || !members.length) return;
    const key = Uint8Array.from(atob(cfg.vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await fetch(`${cfg.apiBase}/subscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), members }) });
  })());
});
