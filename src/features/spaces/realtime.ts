import { buildApiUrl } from '@shared/api/config'
import {
  getAccessToken,
  getTokenSubject,
  isAccessTokenExpired,
} from '@shared/api/authTokens'
import { refreshAccessTokenFromCookie } from '@shared/api/authSession'

export type SpaceEvent = {
  spaceId: number
  resourceType: string
  resourceId: number
  version: number
  action: string
}
export function createEventParser(
  onEvent: (name: string, data: string, id?: string) => void,
) {
  let buffer = ''
  return (chunk: string) => {
    buffer += chunk
    let boundary: RegExpExecArray | null
    while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
      const frame = buffer.slice(0, boundary.index)
      buffer = buffer.slice(boundary.index + boundary[0].length)
      let name = 'message'
      let id: string | undefined
      const data: string[] = []
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('id:') && !line.includes('\u0000'))
          id = line.slice(3).replace(/^ /, '')
        if (line.startsWith('event:')) name = line.slice(6).trim()
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (id !== undefined) onEvent(name, data.join('\n'), id)
      else if (data.length) onEvent(name, data.join('\n'))
    }
  }
}
const pause = (signal: AbortSignal, ms: number) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
async function subscribeToEvents(
  path: string,
  spaceId: number | null,
  signal: AbortSignal,
  changed: (event?: SpaceEvent) => void,
  connection: (connected: boolean) => void,
) {
  const initialToken = getAccessToken()
  const member = initialToken ? getTokenSubject(initialToken) : null
  if (!member) return
  let lastEventId: string | undefined
  const headersFor = (token: string) => ({
    Authorization: `Bearer ${token}`,
    Accept: 'text/event-stream',
    ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
  })
  let retry = 1000
  const sameMember = () => {
    const token = getAccessToken()
    return token !== null && getTokenSubject(token) === member
  }
  while (!signal.aborted && sameMember()) {
    try {
      let token = getAccessToken()
      if (token && isAccessTokenExpired(token))
        token = await refreshAccessTokenFromCookie()
      if (!token || !sameMember() || signal.aborted) return
      let response = await fetch(buildApiUrl(path, 'v2'), {
        headers: headersFor(token),
        credentials: 'include',
        signal,
      })
      if (response.status === 401) {
        token = await refreshAccessTokenFromCookie()
        if (!token || !sameMember() || signal.aborted) return
        response = await fetch(buildApiUrl(path, 'v2'), {
          headers: headersFor(token),
          credentials: 'include',
          signal,
        })
      }
      if (!sameMember() || signal.aborted) {
        await response.body?.cancel()
        return
      }
      if ([401, 403, 404, 410].includes(response.status)) {
        connection(false)
        changed()
        return
      }
      if (!response.ok || !response.body) throw new Error('Stream unavailable')
      connection(true)
      retry = 1000
      // Reconnects may have missed events. Refresh views, preserving any open edit draft.
      changed()
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const parse = createEventParser((name, data, id) => {
        if (signal.aborted || !sameMember()) return
        if (id !== undefined) lastEventId = id
        if (name !== 'changed') return
        try {
          const event = JSON.parse(data) as SpaceEvent
          if (spaceId === null || event.spaceId === spaceId) changed(event)
        } catch {
          /* ignore an incomplete event; reconnect refresh covers it */
        }
      })
      try {
        while (!signal.aborted) {
          const chunk = await reader.read()
          if (chunk.done) break
          parse(decoder.decode(chunk.value, { stream: true }))
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    } catch {
      if (signal.aborted) return
    }
    connection(false)
    await pause(signal, retry)
    retry = Math.min(retry * 2, 30000)
  }
}

export const subscribeToSpace = (
  spaceId: number,
  signal: AbortSignal,
  changed: (event?: SpaceEvent) => void,
  connection: (connected: boolean) => void,
) =>
  subscribeToEvents(
    `/spaces/${spaceId}/events`,
    spaceId,
    signal,
    changed,
    connection,
  )
export const subscribeToWorkspace = (
  signal: AbortSignal,
  changed: (event?: SpaceEvent) => void,
  connection: (connected: boolean) => void,
) => subscribeToEvents('/workspace/events', null, signal, changed, connection)
