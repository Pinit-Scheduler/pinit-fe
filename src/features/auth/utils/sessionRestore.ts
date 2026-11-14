import type { RefreshResult } from '@shared/api/authSession'
import { getApiErrorMessage } from '@shared/api/errorMessage'

const FIRST_RETRY_MS = 1000
const MAX_RETRY_MS = 30_000

/** Wait before the next attempt after `failures` transient failures in a row: 1s, 2s, 4s … up to 30s. */
export const retryDelay = (failures: number) =>
  Math.min(FIRST_RETRY_MS * 2 ** Math.max(failures - 1, 0), MAX_RETRY_MS)

/** The boot screen explains the retry from this many failed attempts on. */
export const RETRY_NOTICE_AFTER = 2

/**
 * Wording for a transient failure. The server's own message is shown when its response carried one;
 * otherwise (no response, or a response without a message) the boot screen keeps its fixed sentence.
 */
export const transientMessage = (result: RefreshResult) =>
  result.kind === 'transient' && result.status >= 400 ? getApiErrorMessage(result.data) : ''

type Callbacks = {
  onRefreshed: (token: string) => void
  /** The session ended: the caller clears tokens and sends the user to the login page. */
  onUnauthorized: () => void
  /** Another attempt is scheduled. `failures` counts the transient failures in a row. */
  onTransient?: (failures: number, result: RefreshResult) => void
}

export type SessionRestore = {
  /** Try again now (the boot screen's button), unless an attempt is already running. */
  retryNow: () => void
  stop: () => void
}

/**
 * Restores the session from the refresh cookie. Only an answered 401/403 ends it. A transient
 * failure keeps trying with backoff, and at once when the browser comes back online or the page
 * becomes visible or focused again.
 */
export const startSessionRestore = (
  refresh: () => Promise<RefreshResult>,
  { onRefreshed, onUnauthorized, onTransient }: Callbacks,
): SessionRestore => {
  let stopped = false
  let running = false
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const stop = () => {
    stopped = true
    clearTimeout(timer)
    window.removeEventListener('online', retryNow)
    window.removeEventListener('focus', retryNow)
    document.removeEventListener('visibilitychange', onVisibility)
  }

  const attempt = async () => {
    if (stopped || running) return
    clearTimeout(timer)
    running = true
    const result = await refresh().catch(
      (error: unknown): RefreshResult => ({ kind: 'transient', status: 0, data: error }),
    )
    running = false
    if (stopped) return
    if (result.kind === 'refreshed') {
      stop()
      onRefreshed(result.token)
      return
    }
    if (result.kind === 'unauthorized') {
      stop()
      onUnauthorized()
      return
    }
    failures += 1
    timer = setTimeout(attempt, retryDelay(failures))
    onTransient?.(failures, result)
  }

  function retryNow() {
    void attempt()
  }

  function onVisibility() {
    if (document.visibilityState === 'visible') retryNow()
  }

  window.addEventListener('online', retryNow)
  window.addEventListener('focus', retryNow)
  document.addEventListener('visibilitychange', onVisibility)
  void attempt()
  return { retryNow, stop }
}
