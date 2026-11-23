import { useEffect, useState, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'

import { fetchMemberZoneId } from '@/api/member'
import { getDisplayZoneId, setDisplayZone, todayKey } from '@/lib/datetime'

const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 표시 시간대. 바뀌면 이 값을 쓰는 화면이 새 시간대로 다시 그린다. */
export const useZoneId = () => useSyncExternalStore(subscribe, getDisplayZoneId, getDisplayZoneId)

/**
 * 회원 시간대를 읽어 표시 시간대로 쓴다(ADR-0028). 로그인한 화면이 열릴 때 한 번 부른다.
 * 실패하면 지금 시간대(기본 Asia/Seoul)를 계속 쓴다.
 */
export const syncMemberZone = async () => {
  try {
    const zoneId = await fetchMemberZoneId()
    if (!zoneId) return
    const before = getDisplayZoneId()
    if (setDisplayZone(zoneId) !== before) listeners.forEach((listener) => listener())
  } catch (error) {
    console.warn('[zone] 회원 시간대를 불러오지 못했어요:', error)
  }
}

/** 표시 시간대의 오늘(YYYY-MM-DD). 자정이 지나거나 앱이 다시 앞으로 오면 바뀐다. */
export const useToday = () => {
  const zoneId = useZoneId()
  const [state, setState] = useState(() => ({ zoneId, today: todayKey() }))
  // 시간대가 바뀌면 같은 렌더에서 그 시간대의 오늘로 맞춘다.
  if (state.zoneId !== zoneId) setState({ zoneId, today: todayKey() })
  useEffect(() => {
    const check = () =>
      setState((previous) => {
        const today = todayKey()
        return previous.today === today ? previous : { ...previous, today }
      })
    const timer = setInterval(check, 30_000)
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') check()
    })
    return () => {
      clearInterval(timer)
      appState.remove()
    }
  }, [])
  return state.zoneId === zoneId ? state.today : todayKey()
}
