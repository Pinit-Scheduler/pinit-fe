import dayjs from 'dayjs'
import { useState } from 'react'
import useScheduleViewState from '../hooks/useScheduleViewState'
import WeeklyDateStrip from '../components/schedules/WeeklyDateStrip'
import OverdueBanner from '../components/schedules/OverdueBanner'
import useWeeklySchedulePresence from '../hooks/useWeeklySchedulePresence'
import useOverdueSchedulesSummary from '../hooks/useOverdueSchedulesSummary'
import ScheduleCard from '../components/schedules/ScheduleCard'
import ScheduleItemActions from '../components/schedules/ScheduleItemActions'
import useScheduleList from '../hooks/useScheduleList'
import StatusPanel from '../components/common/StatusPanel'
import ScheduleDetailModal from '../components/modals/ScheduleDetailModal'
import { deleteSchedule } from '../api/schedules'
import './SchedulesTabPage.css'

const SchedulesTabPage = () => {
  const [detailScheduleId, setDetailScheduleId] = useState<number | null>(null)
  const { currentWeekStart, selectedDate, selectedDateLabel, goToWeek, selectDate } =
    useScheduleViewState()
  const { presenceMap, isLoading: isPresenceLoading, refetch: refetchPresence } =
    useWeeklySchedulePresence({ weekStart: currentWeekStart })
  const { summary: overdueSummary, isLoading: isOverdueLoading, refetch: refetchOverdue } =
    useOverdueSchedulesSummary()
  const { schedules, isLoading: isScheduleLoading, error: scheduleError, refetch: refetchSchedules } =
    useScheduleList(selectedDate)

  // 디버깅: 현재 상태 로깅
  console.log('📄 SchedulesTabPage render:', {
    selectedDate: selectedDate.format('YYYY-MM-DD'),
    selectedDateLabel,
    isPresenceLoading,
    isScheduleLoading,
    schedulesCount: schedules.length,
    scheduleError,
    schedules: schedules.map(s => ({ id: s.id, title: s.title, state: s.state }))
  })

  const handleRefresh = () => {
    console.log('🔄 Manual refresh triggered')
    refetchPresence()
    refetchOverdue()
    refetchSchedules()
  }

  const handleActionClick = async (scheduleId: number, action: () => Promise<void>) => {
    console.log(`🔘 Action button clicked for schedule ${scheduleId}`)
    try {
      await action()
      console.log(`✅ Action completed for schedule ${scheduleId}`)
      refetchSchedules()
    } catch (error) {
      console.error(`❌ Action failed for schedule ${scheduleId}:`, error)
    }
  }

  const handleDelete = async (scheduleId: number) => {
    console.log(`🗑️ Delete schedule ${scheduleId}`)
    try {
      await deleteSchedule(scheduleId)
      console.log(`✅ Schedule deleted: ${scheduleId}`)
      refetchSchedules()
      refetchPresence()
    } catch (error) {
      console.error(`❌ Delete failed for schedule ${scheduleId}:`, error)
      alert('일정 삭제에 실패했습니다.')
    }
  }

  return (
    <section className="schedules-tab">
      {isOverdueLoading ? (
        <StatusPanel variant="loading" title="미완료 일정 정보를 불러오는 중" />
      ) : overdueSummary.hasOverdue ? (
        <OverdueBanner
          summary={overdueSummary}
          onNavigateToDate={(dateKey) => {
            const targetDate = dayjs.tz(dateKey, 'Asia/Seoul')
            selectDate(targetDate)
          }}
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
          schedules.map((schedule) => (
            <div key={schedule.id} className="schedules-tab__item">
              <ScheduleCard
                schedule={schedule}
                onOpenDetail={setDetailScheduleId}
                onDelete={handleDelete}
              />
              <ScheduleItemActions
                schedule={schedule}
                onActionClick={handleActionClick}
              />
            </div>
          ))
        ) : (
          <StatusPanel
            variant="empty"
            title="등록된 일정이 없어요"
            description="일정 추가 탭에서 새로운 일정을 만들어보세요."
          />
        )}
      </div>

      {detailScheduleId && (
        <ScheduleDetailModal
          scheduleId={detailScheduleId}
          onClose={() => setDetailScheduleId(null)}
          onRefresh={refetchSchedules}
        />
      )}
    </section>
  )
}

export default SchedulesTabPage
