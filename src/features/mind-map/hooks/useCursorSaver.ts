import { useEffect, useState } from 'react'
import { saveMindMapCursor } from '../api/mindMapApi'
import type { MindMapResponse } from '../api/mindMapApi'
import { rememberMindMap } from '../api/mindMapQuery'
import { CURSOR_DEBOUNCE_MS } from '../model/saveMachine'

export type CursorSaverDeps = {
  send: (nodeId: string, options: { keepalive: boolean }) => Promise<unknown>
  remember: (update: (previous: MindMapResponse | undefined) => MindMapResponse | undefined) => void
  setTimer: (run: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

/**
 * 마지막으로 고른 가지 저장기. 처음 받은 값은 서버가 준 것이라 보내지 않는다. 선택이 바뀌고
 * `CURSOR_DEBOUNCE_MS` 뒤, 마지막으로 보낸 값과 다를 때만 보낸다. 실패는 알리지 않는다.
 */
export const createCursorSaver = (deps: CursorSaverDeps) => {
  let last: string | null = null
  let pending: string | null = null
  let timer: unknown = null
  const clear = () => {
    if (timer !== null) deps.clearTimer(timer)
    timer = null
  }
  const flush = (keepalive: boolean) => {
    clear()
    const nodeId = pending
    pending = null
    if (nodeId === null || nodeId === last) return
    last = nodeId
    deps.send(nodeId, { keepalive }).then(
      () => deps.remember((previous) => (previous ? { ...previous, cursorNodeId: nodeId } : undefined)),
      () => {},
    )
  }
  return {
    update(nodeId: string | null) {
      if (nodeId === null) return
      if (last === null) {
        last = nodeId
        return
      }
      pending = nodeId
      clear()
      timer = deps.setTimer(() => flush(false), CURSOR_DEBOUNCE_MS)
    },
    /** 남은 값을 바로 보낸다. 떠날 때는 `keepalive`. */
    flush,
  }
}

/** 고른 가지를 서버에 기억시킨다. `pagehide`와 페이지가 사라질 때 남은 값을 keepalive로 보낸다. */
export function useCursorSaver(selectedId: string | null) {
  const [saver] = useState(() =>
    createCursorSaver({
      send: (nodeId, options) => saveMindMapCursor(nodeId, options),
      remember: rememberMindMap,
      setTimer: (run, ms) => window.setTimeout(run, ms),
      clearTimer: (handle) => window.clearTimeout(handle as number),
    }),
  )
  useEffect(() => {
    saver.update(selectedId)
  }, [saver, selectedId])
  useEffect(() => {
    const onHide = () => saver.flush(true)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      saver.flush(true)
    }
  }, [saver])
}
