/**
 * What AuthGuard can decide before its first paint, from local state alone.
 * - 'ready': a valid access token is stored, so the protected page renders at once (no blank frame).
 * - 'refresh': no token or an expired one; the guard asks the server before rendering.
 * - 'logged-out': the user logged out on this device; go straight to the login page.
 */
export type AuthEntry = 'ready' | 'refresh' | 'logged-out'

export const resolveAuthEntry = ({
  loggedOut,
  token,
  isExpired,
}: {
  loggedOut: boolean
  token: string | null
  isExpired: (token: string) => boolean
}): AuthEntry => {
  if (loggedOut) return 'logged-out'
  if (!token || isExpired(token)) return 'refresh'
  return 'ready'
}
