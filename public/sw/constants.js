self.pinitSw = self.pinitSw || {}

self.pinitSw.constants = {
  CACHE_NAME: 'pinit-cache-v1', //TODO CACHE_NAME 자동으로 올릴 기법
  PRECACHE_URLS: [
    '/',
    '/index.html',
    '/manifest.webmanifest',
    '/icons/icon.svg',
    '/vite.svg',
    '/sw/constants.js',
    '/sw/cache.js',
    '/sw/time.js',
    '/sw/idempotency.js',
    '/sw/push.js',
    '/sw/clients.js',
  ],
  KST_TIMEZONE: 'Asia/Seoul',
  IDEMPOTENT_DB_NAME: 'pinit-notifications',
  IDEMPOTENT_STORE_NAME: 'recent-idempotent-keys',
  IDEMPOTENT_KEYS_KEY: 'keys',
  MAX_RECENT_IDEMPOTENT_KEYS: 20,
}