import { getApp, getApps, initializeApp } from 'firebase/app'
import { getMessaging, getToken, isSupported } from 'firebase/messaging'
import type { Messaging } from 'firebase/messaging'
import { getFirebaseConfig } from './config'

let messagingInstance: Messaging | null = null
let lastLoggedToken: string | null = null
let inflightFetch: Promise<string | null> | null = null
let hasWarnedUnsupported = false
let hasWarnedMissingVapidKey = false
let cachedVapidKey: string | null = null

const ensureMessaging = async () => {
  if (messagingInstance) {
    return messagingInstance
  }

  const supported = await isSupported().catch(() => false)
  if (!supported) {
    if (!hasWarnedUnsupported) {
      console.warn('[FCM] Messaging is not supported in this environment.')
      hasWarnedUnsupported = true
    }
    return null
  }

  const firebaseConfig = getFirebaseConfig()
  if (!firebaseConfig) {
    return null
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
  messagingInstance = getMessaging(app)
  return messagingInstance
}

const resolveVapidKey = (provided?: string) => {
  if (provided) {
    cachedVapidKey = provided
    return provided
  }

  if (cachedVapidKey) {
    return cachedVapidKey
  }

  const envKey = "BF8QQIULasLr94n0l0xbv43yZeNICudM5lpQN08VYn2g5VjBPU0wM98HypyRmEb-y0ARRsiZ_wcgSMIC-nq-x20"
  if (envKey) {
    cachedVapidKey = envKey
    return envKey
  }

  return null
}

const retrieveFcmToken = async (registration?: ServiceWorkerRegistration, vapidKeyOverride?: string) => {
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    return null
  }

  const messaging = await ensureMessaging()
  if (!messaging) {
    return null
  }

  const vapidKey = resolveVapidKey(vapidKeyOverride)
  if (!vapidKey) {
    if (!hasWarnedMissingVapidKey) {
      console.warn('[FCM] Missing VAPID key. Set VITE_FIREBASE_VAPID_KEY to enable token issuance.')
      hasWarnedMissingVapidKey = true
    }
    return null
  }

  try {
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    })
    return token || null
  } catch (error) {
    console.warn('[FCM] Failed to fetch token:', error)
    return null
  }
}

export const logFcmTokenOnce = async (registration?: ServiceWorkerRegistration, vapidKey?: string) => {
  if (lastLoggedToken) {
    return lastLoggedToken
  }

  if (!inflightFetch) {
    inflightFetch = retrieveFcmToken(registration, vapidKey)
  }

  const token = await inflightFetch
  inflightFetch = null

  if (token && token !== lastLoggedToken) {
    console.info('[FCM] token:', token)
    lastLoggedToken = token
  }

  return token
}
