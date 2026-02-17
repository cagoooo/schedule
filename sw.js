const CACHE_NAME = 'booking-system-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './config.js',
    './favicon.png',
    'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap',
    // External Firebase scripts are not cached here as they handle their own persistence/caching usually,
    // but for a pure shell we might cache them if they were local. 
    // Since they are CDNs, we rely on browser cache or network.
];

// Install event - cache assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[Service Worker] Caching app shell');
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
});

// Activate event - clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keyList => {
            return Promise.all(keyList.map(key => {
                if (key !== CACHE_NAME) {
                    console.log('[Service Worker] Removing old cache', key);
                    return caches.delete(key);
                }
            }));
        })
    );
    return self.clients.claim();
});

// Fetch event - serve from cache, fall back to network
self.addEventListener('fetch', event => {
    // Navigation requests (HTML) - Network first, fall back to cache
    // This ensures users always see new bookings if online
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .catch(() => {
                    return caches.match('./index.html');
                })
        );
        return;
    }

    // Static assets - Cache first, fall back to network
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                return response || fetch(event.request);
            })
    );
});
