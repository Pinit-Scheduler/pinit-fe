import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  formatOffsetLabel,
  getDisplayOffsetMinutes,
  getDisplayZoneId,
  setDisplayOffset,
} from '@shared/utils/datetime'

type TimePreferencesContextValue = {
  offsetMinutes: number
  offsetLabel: string
  zoneId: string
  isLoading: boolean
  error: string | null
  refresh: () => void
}

const TimePreferencesContext = createContext<TimePreferencesContextValue | null>(null)

export const TimePreferencesProvider = ({ children }: { children: ReactNode }) => {
  const [offsetMinutes, setOffsetMinutes] = useState(() => getDisplayOffsetMinutes())
  const zoneId = useMemo(() => getDisplayZoneId() || 'Asia/Seoul', [])

  useEffect(() => {
    setDisplayOffset(offsetMinutes, zoneId)
  }, [offsetMinutes, zoneId])

  const value = useMemo(
    () => ({
      offsetMinutes,
      zoneId,
      offsetLabel: `${zoneId} (${formatOffsetLabel(offsetMinutes)})`,
      isLoading: false,
      error: null,
      refresh: () => setOffsetMinutes(getDisplayOffsetMinutes()),
    }),
    [offsetMinutes, zoneId],
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
    }
  }
  return ctx
}
