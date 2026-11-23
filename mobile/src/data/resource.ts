import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'

import { getRequestFailureMessage } from '@/api/errors'

// 마지막으로 받은 응답. 탭으로 돌아오면 이 값을 먼저 그리고 뒤에서 새로 받는다.
const cache = new Map<string, unknown>()
const invalidationListeners = new Set<() => void>()

/** 저장이 끝난 뒤 부른다. 지금 보이는 화면의 조회가 모두 다시 받는다. */
export const invalidateResources = () => invalidationListeners.forEach((listener) => listener())

/** 로그아웃할 때 부른다. 다음 회원에게 앞 회원의 응답이 보이지 않게 한다. */
export const clearResources = () => cache.clear()

type State<T> = { key: string; data: T | undefined; error: string | null; fetching: boolean }

const initial = <T,>(key: string): State<T> => ({
  key,
  data: cache.get(key) as T | undefined,
  error: null,
  fetching: false,
})

/**
 * 화면이 보이는 동안의 조회. 화면에 들어올 때마다, 앱이 다시 앞으로 올 때, 저장이 끝났을 때 다시 받는다.
 * 받는 동안에도 앞의 내용을 그대로 보여 준다. `data`가 없을 때만 불러오는 중이거나 실패한 것이다.
 */
export function useResource<T>(key: string, load: (signal: AbortSignal) => Promise<T>, failure: string) {
  const [state, setState] = useState<State<T>>(() => initial<T>(key))
  if (state.key !== key) setState(initial<T>(key))

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })
  const latest = useRef(0)

  const fetchNow = useCallback(
    async (signal?: AbortSignal) => {
      const request = ++latest.current
      setState((previous) => (previous.key === key ? { ...previous, fetching: true } : previous))
      try {
        const data = await loadRef.current(signal ?? new AbortController().signal)
        if (signal?.aborted || request !== latest.current) return
        cache.set(key, data)
        setState({ key, data, error: null, fetching: false })
      } catch (error) {
        if (signal?.aborted || request !== latest.current) return
        setState((previous) =>
          previous.key === key
            ? { ...previous, error: getRequestFailureMessage(error, failure), fetching: false }
            : previous,
        )
      }
    },
    [key, failure],
  )

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController()
      const run = () => void fetchNow(controller.signal)
      run()
      invalidationListeners.add(run)
      const appState = AppState.addEventListener('change', (next) => {
        if (next === 'active') run()
      })
      return () => {
        controller.abort()
        invalidationListeners.delete(run)
        appState.remove()
      }
    }, [fetchNow]),
  )

  const current = state.key === key ? state : initial<T>(key)
  return {
    data: current.data,
    error: current.error,
    /** 보여 줄 내용이 아직 없고 받는 중이다. */
    loading: current.data === undefined && current.error === null,
    fetching: current.fetching,
    reload: fetchNow,
  }
}
