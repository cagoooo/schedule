// Service Worker v2.41.0 - Announcements + Batch Cancel
const CACHE_NAME = 'booking-system-v2.41.0';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './styles.css',
    './styles.v2.38.0.css',
    './app.js',
    './config.js',
    './favicon.png',
    './manifest.json',
    'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap',
];

// ===== Install: 預快取核心資源 =====
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[SW v2.40.0] Caching app shell');
            return cache.addAll(ASSETS_TO_CACHE).catch(err => {
                console.warn('[SW] Some assets failed to cache:', err);
            });
        })
    );
    // 立即啟用新 SW，跳過 waiting 狀態
    self.skipWaiting();
});

// ===== Activate: 清理舊快取 =====
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keyList => {
            return Promise.all(keyList.map(key => {
                if (key !== CACHE_NAME) {
                    console.log('[SW v2.40.0] Removing old cache:', key);
                    return caches.delete(key);
                }
            }));
        }).then(() => self.clients.claim())
    );
});

// ===== Fetch: 三種策略 =====
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Firebase / Firestore / Auth 一律走網路 (即時資料)
    if (url.hostname.includes('firebaseio.com')
        || url.hostname.includes('googleapis.com')
        || url.hostname.includes('firebaseapp.com')
        || url.hostname.includes('firestore')
        || url.hostname.includes('identitytoolkit')) {
        return; // 不攔截，瀏覽器直連
    }

    // HTML 導航：Network First (確保總是最新)
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // 同步更新快取
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => caches.match('./index.html'))
        );
        return;
    }

    // v2.40.0 (C.4): 靜態資源改 Stale-While-Revalidate
    // → 立即回傳快取（快），背景刷新（不錯過更新）
    if (event.request.method === 'GET') {
        event.respondWith(
            caches.match(event.request).then(cachedResponse => {
                const fetchPromise = fetch(event.request).then(networkResponse => {
                    // 2xx 才更新快取，避免 4xx/5xx 污染
                    if (networkResponse && networkResponse.status === 200) {
                        const clone = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return networkResponse;
                }).catch(() => cachedResponse); // 離線：fallback 到快取

                return cachedResponse || fetchPromise;
            })
        );
    }
});

// ===== 收到主執行緒訊息：手動觸發更新 =====
self.addEventListener('message', event => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
