import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchMemberZoneOffset } from '../api/member'
import {
  formatOffsetLabel,
  getDisplayOffsetMinutes,
  parseOffsetString,
  setDisplayOffset,
} from '../utils/datetime'

type TimePreferencesContextValue = {
  offsetMinutes: number
  offsetLabel: string
  isLoading: boolean
  error: string | null
  refresh: () => void
}

const TimePreferencesContext = createContext<TimePreferencesContextValue | null>(null)

export const TimePreferencesProvider = ({ children }: { children: ReactNode }) => {
  const [offsetMinutes, setOffsetMinutes] = useState(() => getDisplayOffsetMinutes())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestId, setRequestId] = useState(() => Date.now())

  useEffect(() => {
    setDisplayOffset(offsetMinutes)
  }, [offsetMinutes])

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const rawOffset = await fetchMemberZoneOffset()
        const parsed = parseOffsetString(rawOffset)
        if (parsed === null) {
          throw new Error('Invalid offset format')
        }
        if (!isMounted) return
        setOffsetMinutes(parsed)
      } catch (err) {
        if (!isMounted) return
        console.error('Failed to fetch member timezone offset:', err)
        setError('시간대 정보를 불러오지 못했어요. 기본 시간대를 사용합니다.')
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    load()

    return () => {
      isMounted = false
    }
  }, [requestId])

  const value = useMemo(
    () => ({
      offsetMinutes,
      offsetLabel: formatOffsetLabel(offsetMinutes),
      isLoading,
      error,
      refresh: () => setRequestId(Date.now()),
    }),
    [error, isLoading, offsetMinutes],
  )

  return <TimePreferencesContext.Provider value={value}>{children}</TimePreferencesContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTimePreferences = () => {
  const ctx = useContext(TimePreferencesContext)
  if (!ctx) {
    return {
      offsetMinutes: getDisplayOffsetMinutes(),
      offsetLabel: formatOffsetLabel(getDisplayOffsetMinutes()),
      isLoading: false,
      error: null,
      refresh: () => {},
    }
  }
  return ctx
}
