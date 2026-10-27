/* Service Worker — trang chính và file code (JS/CSS) ưu tiên mạng, các file còn lại cache-first.
   Lý do: bản trước JS/CSS cache-first nên trang mới (3 nút) có thể đi kèm JS cũ (chỉ 2 nút, nút thứ 3 bấm không được) nếu chỉ mở app 1 lần.
   Không cache dữ liệu IndexedDB (dữ liệu ở trên máy, không qua mạng).
   Bản cũ cache-first cho trang chính nên app cài trên màn hình chính hay kẹt bản cũ sau khi đẩy. */
const CACHE = 'cuoi-chung-minh-v14';
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
  // File code (JS/CSS): ưu tiên mạng để trang và code luôn cùng bản, tránh lệch bản gây nút bấm không được.
  // Mất mạng thì dùng bản đã lưu.
  const url = new URL(e.request.url);
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
    return;
  }
  // File tĩnh khác: dùng cache trước cho nhanh, chưa có thì tải mạng và lưu lại.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => cached || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
