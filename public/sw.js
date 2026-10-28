importScripts(
  '/sw/constants.js?cache=pinit-cache-v16',
  '/sw/cache.js',
  '/sw/time.js',
  '/sw/idempotency.js',
  '/sw/push.js',
  '/sw/content.js',
  '/sw/clients.js',
)

const { constants, cache, time, push, clients, content } = self.pinitSw
const { CACHE_NAME, PRECACHE_URLS } = constants

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => (key === CACHE_NAME ? null : caches.delete(key)))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (!cache.isSameOriginGet(event.request)) return
  event.respondWith(cache.cacheFirst(event.request))
})

self.addEventListener('push', (event) => {
  const payload = push.readPushPayload(event)
  if (!payload) return

  const notificationPayload = payload.notification || {}
  const dataPayload = payload.data || payload

  const { scheduleId, scheduleStartTime, idempotentKey } = dataPayload
  const formattedStart = time.formatStartTime(scheduleStartTime)
  const { title, body } = content.getNotificationContent(notificationPayload, dataPayload, formattedStart)
  const notificationOptions = push.buildNotificationOptions(
    notificationPayload,
    dataPayload,
    scheduleId,
    idempotentKey,
    body,
  )

  event.waitUntil(
    push.showNotificationOnce(title, notificationOptions, idempotentKey),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = clients.resolveTargetUrl(event.notification)
  event.waitUntil(clients.focusOrOpenClient(targetUrl))
})
