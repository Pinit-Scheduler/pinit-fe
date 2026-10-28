import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  formatOffsetLabel,
  getDisplayOffsetMinutes,
  getDisplayZoneId,
  setDisplayZone,
} from '@shared/utils/datetime'
import { readText, STORAGE_KEYS, writeText } from '@shared/utils/safeStorage'

type TimePreferencesContextValue = {
  offsetMinutes: number
  offsetLabel: string
  zoneId: string
  isLoading: boolean
  error: string | null
  refresh: () => void
  /** 회원 시간대를 표시 시간대로 쓴다(ADR-0028). 바뀌면 캐시를 비우고 화면을 새로 그린다. */
  applyZone: (zoneId: string) => void
}

const TimePreferencesContext = createContext<TimePreferencesContextValue | null>(null)

// 마지막으로 받은 회원 시간대로 시작한다. 그래야 서버 응답 전 첫 화면도 같은 시간대로 그린다.
const restoreZone = () => {
  const stored = readText(STORAGE_KEYS.displayZoneId)
  return stored ? setDisplayZone(stored) : getDisplayZoneId() || 'Asia/Seoul'
}

export const TimePreferencesProvider = ({ children }: { children: ReactNode }) => {
  const [zoneId, setZoneId] = useState(restoreZone)
  const [offsetMinutes, setOffsetMinutes] = useState(() => getDisplayOffsetMinutes())

  const applyZone = useCallback((nextZoneId: string) => {
    const applied = setDisplayZone(nextZoneId)
    writeText(STORAGE_KEYS.displayZoneId, applied)
    setZoneId(applied)
    setOffsetMinutes(getDisplayOffsetMinutes())
  }, [])

  const value = useMemo(
    () => ({
      offsetMinutes,
      zoneId,
      offsetLabel: `${zoneId} (${formatOffsetLabel(offsetMinutes)})`,
      isLoading: false,
      error: null,
      refresh: () => setOffsetMinutes(getDisplayOffsetMinutes()),
      applyZone,
    }),
    [offsetMinutes, zoneId, applyZone],
  )

  return <TimePreferencesContext.Provider value={value}>{children}</TimePreferencesContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTimePreferences = () => {
  const ctx = useContext(TimePreferencesContext)
  if (!ctx) {
    return {
      offsetMinutes: getDisplayOffsetMinutes(),
      offsetLabel: `${getDisplayZoneId() || 'Asia/Seoul'} (${formatOffsetLabel(getDisplayOffsetMinutes())})`,
      zoneId: getDisplayZoneId() || 'Asia/Seoul',
      isLoading: false,
      error: null,
      refresh: () => {},
      applyZone: (zoneId: string) => {
        setDisplayZone(zoneId)
      },
    }
  }
  return ctx
}
