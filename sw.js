/* =============================================
   sw.js — Service Worker for マイ家計簿 PWA
   - オフライン時にキャッシュからシェルを返す
   - APIリクエスト（Supabase）はキャッシュしない
   ============================================= */

const CACHE_NAME = 'kakeibo-v1';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/login.html',
  '/form.html',
  '/budget.html',
  '/summary.html',
  '/finance.html',
  '/style.css',
  '/form.css',
  '/budget.css',
  '/summary.css',
  '/app.js',
  '/form.js',
  '/budget.js',
  '/summary.js',
  '/login.js',
  '/closing.js',
  '/finance.js',
  '/supabase-client.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// インストール: シェルファイルをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_FILES).catch((err) => {
        console.warn('[SW] 一部ファイルのキャッシュに失敗:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// アクティベート: 古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// フェッチ: Supabase・CDNはネットワーク優先、それ以外はキャッシュ優先
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Supabase API / CDN は常にネットワーク
  if (url.includes('supabase.co') || url.includes('cdn.jsdelivr') ||
      url.includes('cdnjs.cloudflare') || url.includes('fonts.googleapis') ||
      url.includes('fonts.gstatic')) {
    event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // それ以外: キャッシュ優先 → ネットワーク
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        // 成功したレスポンスをキャッシュに追加
        if (response && response.status === 200 && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // オフライン時: HTMLリクエストならindex.htmlを返す
      if (event.request.headers.get('accept')?.includes('text/html')) {
        return caches.match('/index.html');
      }
    })
  );
});
