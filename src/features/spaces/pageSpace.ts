import { useSyncExternalStore } from 'react'

// 지금 화면의 내용이 속한 스페이스. 고른 스페이스와 다를 수 있는 화면(쪼개기 제안)이 알려 주고 떠날 때 비운다.
// 고른 스페이스는 바꾸지 않는다. 상단 띠가 다른 스페이스의 정보를 내용 위에 두지 않게 하는 데만 쓴다.
let current: number | null = null
const listeners = new Set<() => void>()

export const setPageSpace = (spaceId: number | null) => {
  if (current === spaceId) return
  current = spaceId
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const snapshot = () => current

export const usePageSpace = () => useSyncExternalStore(subscribe, snapshot, snapshot)
