import dayjs from 'dayjs'
import useScheduleViewState from '../hooks/useScheduleViewState'
import WeeklyDateStrip from '../components/schedules/WeeklyDateStrip'
import OverdueBanner from '../components/schedules/OverdueBanner'
import useWeeklySchedulePresence from '../hooks/useWeeklySchedulePresence'
import useOverdueSchedulesSummary from '../hooks/useOverdueSchedulesSummary'
import ScheduleCard from '../components/schedules/ScheduleCard'
import useScheduleList from '../hooks/useScheduleList'
import './SchedulesTabPage.css'

const SchedulesTabPage = () => {
  const { currentWeekStart, selectedDate, selectedDateLabel, goToWeek, selectDate } =
    useScheduleViewState()
  const { presenceMap, isLoading: isPresenceLoading, refetch: refetchPresence } =
    useWeeklySchedulePresence({ weekStart: currentWeekStart })
  const { summary: overdueSummary, isLoading: isOverdueLoading, refetch: refetchOverdue } =
    useOverdueSchedulesSummary()
  const { schedules, isLoading: isScheduleLoading, refetch: refetchSchedules } =
    useScheduleList(selectedDate)

  const handleRefresh = () => {
    refetchPresence()
    refetchOverdue()
    refetchSchedules()
  }

  return (
    <section className="schedules-tab">
      {isOverdueLoading ? (
        <div className="schedules-tab__skeleton">미완료 일정 정보를 불러오는 중...</div>
      ) : (
        <OverdueBanner
          summary={overdueSummary}
          onNavigateToDate={(dateKey) => selectDate(dayjs(dateKey).tz())}
        />
      )}
      <WeeklyDateStrip
        weekStart={currentWeekStart}
        selectedDate={selectedDate}
        presenceMap={presenceMap}
        onSelectDate={selectDate}
        onChangeWeek={goToWeek}
      />
      <header className="schedules-tab__header">
        <h2>{selectedDateLabel}</h2>
        <button type="button" className="schedules-tab__refresh" onClick={handleRefresh}>
          새로고침
        </button>
      </header>
      <div className="schedules-tab__list">
        {isPresenceLoading || isScheduleLoading ? (
          <p>일정을 불러오는 중...</p>
        ) : schedules.length ? (
          schedules.map((schedule) => <ScheduleCard key={schedule.id} schedule={schedule} />)
        ) : (
          <p>이 날짜에는 일정이 없습니다. 새로운 일정을 추가해보세요.</p>
        )}
      </div>
    </section>
  )
}

export default SchedulesTabPage
