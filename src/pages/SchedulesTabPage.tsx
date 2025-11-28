import dayjs from 'dayjs'
import useScheduleViewState from '../hooks/useScheduleViewState'
import WeeklyDateStrip from '../components/schedules/WeeklyDateStrip'
import OverdueBanner from '../components/schedules/OverdueBanner'
import useWeeklySchedulePresence from '../hooks/useWeeklySchedulePresence'
import useOverdueSchedulesSummary from '../hooks/useOverdueSchedulesSummary'
import ScheduleCard from '../components/schedules/ScheduleCard'
import useScheduleList from '../hooks/useScheduleList'
import StatusPanel from '../components/common/StatusPanel'
import './SchedulesTabPage.css'

const SchedulesTabPage = () => {
  const { currentWeekStart, selectedDate, selectedDateLabel, goToWeek, selectDate } =
    useScheduleViewState()
  const { presenceMap, isLoading: isPresenceLoading, refetch: refetchPresence } =
    useWeeklySchedulePresence({ weekStart: currentWeekStart })
  const { summary: overdueSummary, isLoading: isOverdueLoading, refetch: refetchOverdue } =
    useOverdueSchedulesSummary()
  const { schedules, isLoading: isScheduleLoading, error: scheduleError, refetch: refetchSchedules } =
    useScheduleList(selectedDate)

  const handleRefresh = () => {
    refetchPresence()
    refetchOverdue()
    refetchSchedules()
  }

  return (
    <section className="schedules-tab">
      {isOverdueLoading ? (
        <StatusPanel variant="loading" title="미완료 일정 정보를 불러오는 중" />
      ) : overdueSummary.hasOverdue ? (
        <OverdueBanner
          summary={overdueSummary}
          onNavigateToDate={(dateKey) => selectDate(dayjs(dateKey).tz())}
        />
      ) : null}
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
          <StatusPanel variant="loading" title="일정을 불러오는 중" />
        ) : scheduleError ? (
          <StatusPanel
            variant="error"
            title="일정을 불러오지 못했어요"
            description={scheduleError}
            action={<button onClick={refetchSchedules}>재시도</button>}
          />
        ) : schedules.length ? (
          schedules.map((schedule) => <ScheduleCard key={schedule.id} schedule={schedule} />)
        ) : (
          <StatusPanel
            variant="empty"
            title="등록된 일정이 없어요"
            description="일정 추가 탭에서 새로운 일정을 만들어보세요."
          />
        )}
      </div>
    </section>
  )
}

export default SchedulesTabPage
