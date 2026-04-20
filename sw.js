// Service Worker v2.48.1 - 🐛 修正 Gemini 模型 + LINE 推播診斷透明化
const CACHE_NAME = 'booking-system-v2.48.1';
const APP_VERSION = 'v2.48.1';
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
// v2.41.1: 改為「等候模式」, 由前端通知使用者後再 skipWaiting
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log(`[SW ${APP_VERSION}] Caching app shell`);
            return cache.addAll(ASSETS_TO_CACHE).catch(err => {
                console.warn('[SW] Some assets failed to cache:', err);
            });
        })
    );
    // ⚠ 不主動 skipWaiting, 改由前端 banner 點擊「立即更新」後觸發
    // 這樣使用者填預約表單時不會被打斷
});

// ===== Activate: 清理舊快取 + 立即接管所有分頁 =====
// v2.41.6: 並行執行 cleanup + claim, 避免 cleanup 卡住導致 claim 不執行
self.addEventListener('activate', event => {
    console.log(`[SW ${APP_VERSION}] Activating...`);
    event.waitUntil(
        Promise.all([
            // 清理舊快取
            caches.keys().then(keyList => Promise.all(
                keyList
                    .filter(key => key !== CACHE_NAME)
                    .map(key => {
                        console.log(`[SW ${APP_VERSION}] Removing old cache:`, key);
                        return caches.delete(key);
                    })
            )),
            // 立即接管所有 client (這是 controllerchange 觸發的關鍵)
            self.clients.claim()
        ]).then(() => {
            console.log(`[SW ${APP_VERSION}] Activated and claimed clients`);
            // 主動通知所有 client 已啟用 (備援方案, 萬一 controllerchange 沒觸發)
            return self.clients.matchAll({ type: 'window' }).then(clients => {
                clients.forEach(client => {
                    client.postMessage({ type: 'SW_ACTIVATED', version: APP_VERSION });
                });
            });
        })
    );
});

// ===== Fetch: 三種策略 =====
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // v2.41.4: 過濾 Cache API 不支援的 scheme (chrome-extension/moz-extension/data:/blob: 等)
    // 否則背景擴充功能 (例如書籤同步、密碼管理器) 會觸發 cache.put 失敗錯誤
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return; // 直接交給瀏覽器處理
    }

    // 只處理同 origin + 已知 CDN, 避免攔截到第三方追蹤工具
    const isSameOrigin = url.origin === self.location.origin;
    const isAllowedCDN = url.hostname === 'fonts.googleapis.com'
        || url.hostname === 'fonts.gstatic.com'
        || url.hostname === 'www.gstatic.com';
    if (!isSameOrigin && !isAllowedCDN) {
        return; // Firebase/其他 CDN 走網路, 不快取
    }

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
                    // v2.41.4: 多重檢查避免快取污染
                    // - 必須 2xx 狀態
                    // - 必須是 basic 或 cors response (不能是 opaque)
                    // - 雙重保險: try/catch 包住 cache.put
                    if (networkResponse
                        && networkResponse.status === 200
                        && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
                        const clone = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, clone).catch(err => {
                                // 個別請求快取失敗不影響使用者 (例如 chrome-extension 雖已過濾但留底)
                                console.warn('[SW] cache.put failed:', event.request.url, err.message);
                            });
                        });
                    }
                    return networkResponse;
                }).catch(() => cachedResponse); // 離線：fallback 到快取

                return cachedResponse || fetchPromise;
            })
        );
    }
});

// ===== 收到主執行緒訊息：手動觸發更新 / 查詢版本 =====
self.addEventListener('message', event => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    } else if (event.data === 'GET_VERSION') {
        // 回傳當前 SW 版本給前端
        if (event.source) {
            event.source.postMessage({ type: 'VERSION', version: APP_VERSION });
        }
    }
});
