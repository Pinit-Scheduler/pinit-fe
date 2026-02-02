const DEFAULT_VERSION = 'v0'

const SERVICE_VERSIONS = {
  api: 'v2',
  auth: DEFAULT_VERSION,
  notification: DEFAULT_VERSION,
} as const

const normalizeVersion = (version?: string) =>
  (version ?? '').replace(/^\/+|\/+$/g, '')

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, '')

const ensurePath = (path: string) => (path.startsWith('/') ? path : `/${path}`)

const withVersion = (baseUrl: string, version?: string) => {
  const normalizedVersion = normalizeVersion(version)
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  return normalizedVersion ? `${normalizedBaseUrl}/${normalizedVersion}` : normalizedBaseUrl
}

const rawApiBaseUrl =
  import.meta.env.PROD && import.meta.env.VITE_API_BASE_URL
    ? import.meta.env.VITE_API_BASE_URL
    : import.meta.env.PROD
      ? 'https://api.pinit.go-gradually.me'
      : 'http://localhost:8080'

const rawAuthBaseUrl =
  import.meta.env.VITE_AUTH_BASE_URL ||
  (import.meta.env.PROD ? 'https://auth.pinit.go-gradually.me' : 'http://localhost:8081')

const rawNotificationBaseUrl =
  import.meta.env.VITE_NOTIFICATION_API_BASE_URL ||
  (import.meta.env.PROD ? 'https://notification.pinit.go-gradually.me' : 'http://localhost:8082')

const API_VERSION = normalizeVersion(SERVICE_VERSIONS.api)
const AUTH_API_VERSION = normalizeVersion(SERVICE_VERSIONS.auth)
const NOTIFICATION_API_VERSION = normalizeVersion(SERVICE_VERSIONS.notification)

export const API_BASE_URLS = {
  v0: withVersion(rawApiBaseUrl, 'v0'),
  v1: withVersion(rawApiBaseUrl, 'v1'),
  v2: withVersion(rawApiBaseUrl, 'v2'),
}

export const API_BASE_URL = withVersion(rawApiBaseUrl, API_VERSION)
export const AUTH_BASE_URL = withVersion(rawAuthBaseUrl, AUTH_API_VERSION)
export const NOTIFICATION_BASE_URL = withVersion(rawNotificationBaseUrl, NOTIFICATION_API_VERSION)

export const buildApiUrl = (path: string, version: 'v0' | 'v1' | 'v2' | '' = 'v2') => {
  const base =
    version === ''
      ? normalizeBaseUrl(rawApiBaseUrl)
      : API_BASE_URLS[version] ?? withVersion(rawApiBaseUrl, version)
  return `${base}${ensurePath(path)}`
}
export const buildAuthUrl = (path: string) => `${AUTH_BASE_URL}${ensurePath(path)}`
export const buildNotificationUrl = (path: string) =>
  `${NOTIFICATION_BASE_URL}${ensurePath(path)}`

export const buildUrl = (baseUrl: string, path: string) =>
  `${normalizeBaseUrl(baseUrl)}${ensurePath(path)}`
