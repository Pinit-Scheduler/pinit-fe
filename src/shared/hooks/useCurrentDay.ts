import { useMemo, useSyncExternalStore } from 'react'
import dayjs from 'dayjs'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { getTodayWithOffset } from '@shared/utils/datetime'
const subscribe = (listener: () => void) => {
  const timer = window.setInterval(listener, 30000)
  window.addEventListener('focus', listener)
  return () => {
    clearInterval(timer)
    window.removeEventListener('focus', listener)
  }
}
export default function useCurrentDay() {
  const { zoneId } = useTimePreferences()
  const date = useSyncExternalStore(subscribe, () =>
    getTodayWithOffset().format('YYYY-MM-DD'),
  )
  return useMemo(() => dayjs.tz(date + 'T12:00:00', zoneId), [date, zoneId])
}
