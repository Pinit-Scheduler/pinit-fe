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

const IDEMPOTENT_DB_NAME = 'pinit-notifications'
const IDEMPOTENT_STORE_NAME = 'recent-idempotent-keys'
const IDEMPOTENT_KEYS_KEY = 'keys'
const MAX_RECENT_IDEMPOTENT_KEYS = 20

const openIdempotentDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(IDEMPOTENT_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IDEMPOTENT_STORE_NAME)) {
        db.createObjectStore(IDEMPOTENT_STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'))
  })

const readRecentIdempotentKeys = async () => {
  const db = await openIdempotentDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDEMPOTENT_STORE_NAME, 'readonly')
    const store = tx.objectStore(IDEMPOTENT_STORE_NAME)
    const request = store.get(IDEMPOTENT_KEYS_KEY)
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : [])
    request.onerror = () => reject(request.error || new Error('Failed to read idempotent keys'))
  })
}

const writeRecentIdempotentKeys = async (keys) => {
  const db = await openIdempotentDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDEMPOTENT_STORE_NAME, 'readwrite')
    const store = tx.objectStore(IDEMPOTENT_STORE_NAME)
    const request = store.put(keys, IDEMPOTENT_KEYS_KEY)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error || new Error('Failed to store idempotent keys'))
  })
}

const hasRecentIdempotentKey = async (key) => {
  try {
    const keys = await readRecentIdempotentKeys()
    return keys.includes(key)
  } catch (error) {
    console.warn('[SW] Failed to read idempotent keys:', error)
    return false
  }
}

const saveIdempotentKey = async (key) => {
  try {
    const keys = await readRecentIdempotentKeys()
    const nextKeys = [key, ...keys.filter((k) => k !== key)].slice(0, MAX_RECENT_IDEMPOTENT_KEYS)
    await writeRecentIdempotentKeys(nextKeys)
  } catch (error) {
    console.warn('[SW] Failed to persist idempotent key:', error)
  }
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

  const notificationPayload = payload.notification || {}
  const dataPayload = payload.data || payload

  const { scheduleId, scheduleTitle, scheduleStartTime, idempotentKey } = dataPayload
  const formattedStart = formatStartTime(scheduleStartTime)
  const idempotencyKey = idempotentKey

  const title = notificationPayload.title
    ? notificationPayload.title
    : scheduleTitle
      ? `"${scheduleTitle}" 일정이 시작돼요`
      : '일정 시작 알림'
  const body = notificationPayload.body
    ? notificationPayload.body
    : formattedStart || scheduleStartTime
      ? `${formattedStart || scheduleStartTime} 시작 예정이에요.`
      : '일정이 곧 시작돼요.'

  const notificationOptions = {
    body,
    icon: notificationPayload.icon || '/icons/pinit-app-logo.png',
    badge: '/icons/pinit-app-logo.png',
    tag: idempotentKey || (scheduleId ? `schedule-${scheduleId}` : undefined),
    data: {
      ...dataPayload,
      url: scheduleId ? `/app/schedules?scheduleId=${scheduleId}` : '/app/schedules',
    },
  }

  event.waitUntil(
    (async () => {
      if (idempotencyKey) {
        const isDuplicate = await hasRecentIdempotentKey(idempotencyKey)
        if (isDuplicate) {
          return
        }
        await saveIdempotentKey(idempotencyKey)
      }
      return self.registration.showNotification(title, notificationOptions)
    })(),
  )
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
