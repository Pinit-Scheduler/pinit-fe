self.pinitSw = self.pinitSw || {}

self.pinitSw.constants = {
  CACHE_NAME: 'pinit-cache-v1',
  PRECACHE_URLS: ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg', '/vite.svg'],
  KST_TIMEZONE: 'Asia/Seoul',
  IDEMPOTENT_DB_NAME: 'pinit-notifications',
  IDEMPOTENT_STORE_NAME: 'recent-idempotent-keys',
  IDEMPOTENT_KEYS_KEY: 'keys',
  MAX_RECENT_IDEMPOTENT_KEYS: 20,
}
