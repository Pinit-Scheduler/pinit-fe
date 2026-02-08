importScripts(
  '/sw/constants.js',
  '/sw/cache.js',
  '/sw/time.js',
  '/sw/idempotency.js',
  '/sw/push.js',
  '/sw/clients.js',
)

const { constants, cache, time, push, clients } = self.pinitSw
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

const getNotificationContent = (notificationPayload, scheduleTitle, formattedStart, scheduleStartTime) => {
  const title = notificationPayload.title
    ? notificationPayload.title
    : scheduleTitle
      ? `"${scheduleTitle}" 일정이 시작돼요`
      : '일정 시작 알림'
  const scheduleLabel = formattedStart || scheduleStartTime
  const body = notificationPayload.body
    ? notificationPayload.body
    : scheduleLabel
      ? `${scheduleLabel} 시작 예정이에요.`
      : '일정이 곧 시작돼요.'
  return { title, body }
}

self.addEventListener('push', (event) => {
  const payload = push.readPushPayload(event)
  if (!payload) return

  const notificationPayload = payload.notification || {}
  const dataPayload = payload.data || payload

  const { scheduleId, scheduleTitle, scheduleStartTime, idempotentKey } = dataPayload
  const formattedStart = time.formatStartTime(scheduleStartTime)
  const { title, body } = getNotificationContent(
    notificationPayload,
    scheduleTitle,
    formattedStart,
    scheduleStartTime,
  )
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
