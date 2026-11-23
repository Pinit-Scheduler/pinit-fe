import { useSyncExternalStore } from 'react'

import type { Schedule, Task } from '@/api/types'

// 화면들이 함께 보는 최신 일정·작업. 버전이 더 높은 것만 받아들이므로,
// 저장 직후 늦게 도착한 목록 응답이 화면을 저장 전 상태로 되돌리지 못한다.
type Versioned = { id: number; version: number }

const createStore = <T extends Versioned>() => {
  let items = new Map<number, T>()
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  return {
    remember(next: T | readonly T[]) {
      const list = Array.isArray(next) ? (next as readonly T[]) : [next as T]
      let changed = false
      const copy = new Map(items)
      for (const item of list) {
        const known = copy.get(item.id)
        if (known && known.version > item.version) continue
        if (known === item) continue
        copy.set(item.id, item)
        changed = true
      }
      if (!changed) return
      items = copy
      listeners.forEach((listener) => listener())
    },
    clear() {
      items = new Map()
      listeners.forEach((listener) => listener())
    },
    /** 받은 항목과 저장소의 항목 중 버전이 높은 쪽. */
    useLatest(item: T): T {
      const known = useSyncExternalStore(
        subscribe,
        () => items.get(item.id),
        () => items.get(item.id),
      )
      return known && known.version >= item.version ? known : item
    },
  }
}

export const schedules = createStore<Schedule>()
export const tasks = createStore<Task>()

export const clearEntities = () => {
  schedules.clear()
  tasks.clear()
}
