import { useContext, useState } from 'react'
import dayjs from 'dayjs'
import { formatDisplayDate, getTodayWithOffset, getWeekStart, toDateKey } from '../utils/datetime'
import { ScheduleViewStateContext } from '../context/ScheduleViewStateContext'

const useScheduleViewState = () => {
  const sharedState = useContext(ScheduleViewStateContext)

  const today = getTodayWithOffset()
  const initialWeekStart = getWeekStart(today)

  const [currentWeekStart, setCurrentWeekStart] = useState(initialWeekStart)
  const [selectedDate, setSelectedDate] = useState(today)

  const goToWeek = (offset: number) => {
    const nextWeekStart = currentWeekStart.add(offset, 'week')
    const currentWeekdayIndex = selectedDate.diff(currentWeekStart, 'day')
    const candidate = nextWeekStart.add(currentWeekdayIndex, 'day')
    const todayKST = getTodayWithOffset()
    const nextSelectedDate = candidate.isAfter(todayKST, 'day') ? todayKST : candidate
    setCurrentWeekStart(nextWeekStart)
    setSelectedDate(nextSelectedDate)
  }

  const selectDate = (date: dayjs.Dayjs) => {
    setSelectedDate(date)
    const newWeekStart = getWeekStart(date)
    setCurrentWeekStart(newWeekStart)
  }

  const resetToToday = () => {
    const nextToday = getTodayWithOffset()
    setSelectedDate(nextToday)
    setCurrentWeekStart(getWeekStart(nextToday))
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
