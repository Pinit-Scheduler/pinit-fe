import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type dayjs from 'dayjs'
import { getTodayWithOffset, getWeekStart } from '@shared/utils/datetime'
import { useTimePreferences } from '@contexts/TimePreferencesContext'

export type ScheduleViewStateValue = {
  currentWeekStart: dayjs.Dayjs
  selectedDate: dayjs.Dayjs
  selectedDateLabel: string
  selectedDateKey: string
  goToWeek: (offset: number) => void
  selectDate: (date: dayjs.Dayjs) => void
  resetToToday: () => void
}

// eslint-disable-next-line react-refresh/only-export-components
export const ScheduleViewStateContext = createContext<ScheduleViewStateValue | null>(null)

export const ScheduleViewStateProvider = ({ children }: { children: ReactNode }) => {
  const { offsetMinutes } = useTimePreferences()
  const today = useMemo(() => getTodayWithOffset(offsetMinutes), [offsetMinutes])
  const toDateKeyWithOffset = useCallback(
    (date: dayjs.Dayjs) => date.utcOffset(offsetMinutes).format('YYYY-MM-DD'),
    [offsetMinutes],
  )
  const formatLabel = useCallback(
    (date: dayjs.Dayjs) => date.utcOffset(offsetMinutes).format('M월 D일 (dd)'),
    [offsetMinutes],
  )
  const [currentWeekStart, setCurrentWeekStart] = useState(() => getWeekStart(today))
  const [selectedDate, setSelectedDate] = useState(today)

  const goToWeek = useCallback(
    (offset: number) => {
      const targetWeekStart = getWeekStart(selectedDate.add(offset, 'week'))
      const candidate = targetWeekStart.add(selectedDate.diff(getWeekStart(selectedDate), 'day'), 'day')
      setCurrentWeekStart(targetWeekStart)
      setSelectedDate(candidate)
    },
    [selectedDate],
  )

  const selectDate = useCallback((date: dayjs.Dayjs) => {
    setSelectedDate(date)
    setCurrentWeekStart(getWeekStart(date))
  }, [])

  const resetToToday = useCallback(() => {
    const nextToday = getTodayWithOffset(offsetMinutes)
    setSelectedDate(nextToday)
    setCurrentWeekStart(getWeekStart(nextToday))
  }, [offsetMinutes])

  const value = useMemo(
    () => ({
      currentWeekStart,
      selectedDate,
      selectedDateLabel: formatLabel(selectedDate),
      selectedDateKey: toDateKeyWithOffset(selectedDate),
      goToWeek,
      selectDate,
      resetToToday,
    }),
    [currentWeekStart, formatLabel, goToWeek, resetToToday, selectDate, selectedDate, toDateKeyWithOffset],
  )

  return (
    <ScheduleViewStateContext.Provider value={value}>
      {children}
    </ScheduleViewStateContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useScheduleViewStateContext = () => {
  const ctx = useContext(ScheduleViewStateContext)
  if (!ctx) {
    throw new Error('ScheduleViewStateContext not found')
  }
  return ctx
}
