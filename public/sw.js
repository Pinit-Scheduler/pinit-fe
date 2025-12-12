const CACHE_NAME = 'pinit-cache-v1'
const PRECACHE_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg', '/vite.svg']

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
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) {
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          return response
        })
        .catch(() => cached)
    }),
  )
})

const formatStartTime = (value) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload = {}
  try {
    payload = event.data.json()
  } catch (error) {
    try {
      payload = JSON.parse(event.data.text())
    } catch (parseError) {
      payload = {}
    }
  }

  const { scheduleId, scheduleTitle, scheduleStartTime, idempotentKey } = payload
  const formattedStart = formatStartTime(scheduleStartTime)

  const title = scheduleTitle ? `"${scheduleTitle}" 일정이 시작돼요` : '일정 시작 알림'
  const body =
    formattedStart || scheduleStartTime
      ? `${formattedStart || scheduleStartTime} 시작 예정이에요.`
      : '일정이 곧 시작돼요.'

  const notificationOptions = {
    body,
    icon: '/icons/pinit-app-logo.png',
    badge: '/icons/pinit-app-logo.png',
    tag: idempotentKey || (scheduleId ? `schedule-${scheduleId}` : undefined),
    data: {
      url: scheduleId ? `/app/schedules?scheduleId=${scheduleId}` : '/app/schedules',
    },
  }

  event.waitUntil(self.registration.showNotification(title, notificationOptions))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetPath =
    (event.notification && event.notification.data && event.notification.data.url) || '/app/schedules'
  const targetUrl = new URL(targetPath, self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        const isSamePath = client.url === targetUrl
        if ('focus' in client) {
          if (isSamePath) {
            return client.focus()
          }
          if ('navigate' in client) {
            client.navigate(targetUrl)
          }
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
      return null
    }),
  )
})
