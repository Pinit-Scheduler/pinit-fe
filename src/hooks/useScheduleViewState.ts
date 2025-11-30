import { useContext, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { formatDisplayDate, getTodayKST, getWeekStart, toDateKey } from '../utils/datetime'
import { ScheduleViewStateContext } from '../context/ScheduleViewStateContext'

const useScheduleViewState = () => {
  const sharedState = useContext(ScheduleViewStateContext)

  const today = useMemo(() => getTodayKST(), [])
  const initialWeekStart = useMemo(() => getWeekStart(today), [today])

  const [currentWeekStart, setCurrentWeekStart] = useState(initialWeekStart)
  const [selectedDate, setSelectedDate] = useState(today)

  const goToWeek = (offset: number) => {
    const nextWeekStart = currentWeekStart.add(offset, 'week')
    setCurrentWeekStart(nextWeekStart)

    const currentWeekdayIndex = selectedDate.diff(currentWeekStart, 'day')
    const nextSelectedDate = nextWeekStart.add(currentWeekdayIndex, 'day')
    setSelectedDate(nextSelectedDate)
  }

  const selectDate = (date: dayjs.Dayjs) => {
    setSelectedDate(date)
    const newWeekStart = getWeekStart(date)
    setCurrentWeekStart(newWeekStart)
  }

  const resetToToday = () => {
    setSelectedDate(today)
    setCurrentWeekStart(initialWeekStart)
  }

  const fallbackState = {
    currentWeekStart,
    selectedDate,
    selectedDateLabel: formatDisplayDate(selectedDate),
    selectedDateKey: toDateKey(selectedDate),
    goToWeek,
    selectDate,
    resetToToday,
  }

  return sharedState ?? fallbackState
}

type UseScheduleViewStateReturn = ReturnType<typeof useScheduleViewState>

export type { UseScheduleViewStateReturn }
export default useScheduleViewState
