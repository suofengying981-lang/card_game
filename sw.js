/* 离线缓存：先用缓存秒开，同时后台更新；下次打开即是最新版 */
const CACHE = 'ddz-v11';
const ASSETS = [
  './', 'index.html', 'ddz.html', 'nn.js', 'ddz_nn.bin', 'sichuan.html', 'style.css', 'engine.js', 'game.js',
  'mahjong.html', 'poker.html', 'poker.css', 'poker.js', 'poker-engine.js', 'sfx.js',
  'tiaoqi.html', 'tiaoqi-engine.js', 'junqi.html', 'junqi-engine.js', 'guandan.html', 'guandan-engine.js',
  'bridge.html', 'bridge.css', 'bridge.js', 'bridge-engine.js', 'bridge-bid.js', 'bridge-play.js',
  'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req, { ignoreSearch: true }).then((hit) => {
        const net = fetch(req)
          .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })
          .catch(() => hit);
        return hit || net;
      })
    )
  );
});
