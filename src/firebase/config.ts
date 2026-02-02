import type { FirebaseOptions } from 'firebase/app'

const envConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

const requiredConfigKeys: Array<keyof FirebaseOptions> = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
]

let hasWarnedMissingConfig = false

export const getFirebaseConfig = (): FirebaseOptions | null => {
  // FCM은 프로덕션에서만 활성화
  if (!import.meta.env.PROD) {
    return null
  }

  const missingKeys = requiredConfigKeys.filter((key) => !envConfig[key])
  if (missingKeys.length > 0) {
    if (!hasWarnedMissingConfig) {
      console.warn('[FCM] Missing Firebase config values:', missingKeys.join(', '))
      hasWarnedMissingConfig = true
    }
    return null
  }

  return envConfig
}
