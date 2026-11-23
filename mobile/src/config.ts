const trimSlash = (value: string) => value.replace(/\/+$/, '')

/** The API host. The same default as the web build's production value (src/shared/api/config.ts). */
export const API_ORIGIN = trimSlash(
  process.env.EXPO_PUBLIC_API_BASE_URL || 'https://mono.pinit.go-gradually.me',
)

/** The web app shown inside the WebView for the deeper screens. */
export const WEB_ORIGIN = trimSlash(
  process.env.EXPO_PUBLIC_WEB_BASE_URL || 'https://pinit.go-gradually.me',
)

export type ApiVersion = 'v0' | 'v2'

export const apiUrl = (path: string, version: ApiVersion = 'v2') =>
  `${API_ORIGIN}/${version}${path.startsWith('/') ? path : `/${path}`}`

/**
 * Added to the WebView's user agent. The web app reads it to know it runs inside this app
 * (src/shared/native/nativeShell.ts in the web source). Keep the two in step.
 */
export const APP_USER_AGENT = 'PinitApp/1'
