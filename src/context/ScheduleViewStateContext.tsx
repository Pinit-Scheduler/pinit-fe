import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import dayjs from 'dayjs'
import { formatDisplayDate, getTodayKST, getWeekStart, toDateKey } from '../utils/datetime'

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
  const today = useMemo(() => getTodayKST(), [])
  const [currentWeekStart, setCurrentWeekStart] = useState(() => getWeekStart(today))
  const [selectedDate, setSelectedDate] = useState(today)

  const goToWeek = useCallback((offset: number) => {
    setCurrentWeekStart((prevWeekStart) => {
      const nextWeekStart = prevWeekStart.add(offset, 'week')
      setSelectedDate((prevSelected) => {
        const currentWeekdayIndex = prevSelected.diff(prevWeekStart, 'day')
        return nextWeekStart.add(currentWeekdayIndex, 'day')
      })
      return nextWeekStart
    })
  }, [])

  const selectDate = useCallback((date: dayjs.Dayjs) => {
    setSelectedDate(date)
    setCurrentWeekStart(getWeekStart(date))
  }, [])

  const resetToToday = useCallback(() => {
    setSelectedDate(today)
    setCurrentWeekStart(getWeekStart(today))
  }, [today])

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
