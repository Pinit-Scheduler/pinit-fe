import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import dayjs from 'dayjs'
import { formatDisplayDate, getTodayWithOffset, getWeekStart, toDateKey } from '../utils/datetime'

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
  const today = useMemo(() => getTodayWithOffset(), [])
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
    const nextToday = getTodayWithOffset()
    setSelectedDate(nextToday)
    setCurrentWeekStart(getWeekStart(nextToday))
  }, [])

  const value = useMemo(
    () => ({
      currentWeekStart,
      selectedDate,
      selectedDateLabel: formatDisplayDate(selectedDate),
      selectedDateKey: toDateKey(selectedDate),
      goToWeek,
      selectDate,
      resetToToday,
    }),
    [currentWeekStart, goToWeek, resetToToday, selectDate, selectedDate],
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
