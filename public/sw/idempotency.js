self.pinitSw = self.pinitSw || {}

const {
  IDEMPOTENT_DB_NAME,
  IDEMPOTENT_STORE_NAME,
  IDEMPOTENT_KEYS_KEY,
  MAX_RECENT_IDEMPOTENT_KEYS,
} = self.pinitSw.constants

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

self.pinitSw.idempotency = {
  hasRecentIdempotentKey,
  saveIdempotentKey,
}
