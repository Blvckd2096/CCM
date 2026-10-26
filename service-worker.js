/* Service Worker — trang chính ưu tiên mạng (mất mạng mới dùng cache), các file còn lại cache-first.
   Không cache dữ liệu IndexedDB (dữ liệu ở trên máy, không qua mạng).
   Bản cũ cache-first cho trang chính nên app cài trên màn hình chính hay kẹt bản cũ sau khi đẩy. */
const CACHE = 'cuoi-chung-minh-v6';
const ASSETS = [
  './', './index.html', './style.css', './app.js', './db.js',
  './manifest.json', './icons/icon-192.png', './icons/icon-512.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Trang chính: có mạng thì lấy bản mới nhất, mất mạng thì dùng bản đã lưu.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }
  // File tĩnh: dùng cache trước cho nhanh, chưa có thì tải mạng và lưu lại.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => cached || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
