// 쪼개기 시작 요청의 저장소. 카드와 작업 상세가 요청을 넣고, 흐름은 SplitStartHost가 맡는다.
import type { TaskSplitInfo } from './api/taskSplitInfo'

export type SplitStartTarget = { id: number; split?: TaskSplitInfo | null }

let current: SplitStartTarget | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

export const subscribeSplitStart = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const currentSplitStart = () => current

/** 쪼개기를 시작한다. 앞선 요청이 남아 있으면 이 요청으로 바꾼다. */
export const requestSplitStart = (task: SplitStartTarget) => {
  current = task
  emit()
}
export const clearSplitStart = () => {
  current = null
  emit()
}
