import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import useScheduleViewState from '../../../hooks/useScheduleViewState.ts'
import WeeklyDateStrip from '../../../components/schedules/WeeklyDateStrip.tsx'
import OverdueBanner from '../../../components/schedules/OverdueBanner.tsx'
import useWeeklySchedulePresence from '../../../hooks/useWeeklySchedulePresence.ts'
import useOverdueSchedulesSummary from '../../../hooks/useOverdueSchedulesSummary.ts'
import ScheduleCard from '../../../components/schedules/ScheduleCard.tsx'
import ScheduleItemActions from '../../../components/schedules/ScheduleItemActions.tsx'
import useScheduleList from '../../../hooks/useScheduleList.ts'
import StatusPanel from '../../../components/common/StatusPanel.tsx'
import ScheduleDetailModal from '../../../components/modals/ScheduleDetailModal.tsx'
import { deleteSchedule, startSchedule, cancelSchedule } from '../../../api/schedules.ts'
import useWeeklyStatistics from '../../../hooks/useWeeklyStatistics.ts'
import { formatMinutesToTime } from '../../../utils/statisticsTransform.ts'
import './SchedulesTabPage.css'
import '../../../utils/datetime.ts'
import { useToast } from '../../../context/ToastContext'

const SchedulesTabPage = () => {
  const [detailScheduleId, setDetailScheduleId] = useState<number | null>(null)
  const {
    currentWeekStart,
    selectedDate,
    selectedDateLabel,
    selectedDateKey,
    goToWeek,
    selectDate,
  } = useScheduleViewState()
  const { addToast } = useToast()
  const { presenceMap, isLoading: isPresenceLoading, error: presenceError, refetch: refetchPresence } =
    useWeeklySchedulePresence({ weekStart: currentWeekStart, anchorDate: selectedDate })
  const {
    schedules: schedulesByDate,
    isLoading: isScheduleLoadingRaw,
    error: scheduleErrorRaw,
    refetch: refetchSchedulesRaw,
  } = useScheduleList(selectedDate)
  const { summary: overdueSummary, isLoading: isOverdueLoading, refetch: refetchOverdue } =
    useOverdueSchedulesSummary()
  const {
    current: weeklyStats,
    isLoading: isWeeklyStatsLoading,
    error: weeklyStatsError,
    refetch: refetchWeeklyStats,
  } = useWeeklyStatistics({ weekStart: currentWeekStart.add(1, 'day') })

  const schedules = schedulesByDate
  const isScheduleLoading = isPresenceLoading || isScheduleLoadingRaw
  const scheduleError = scheduleErrorRaw ?? presenceError
  const refetchSchedules = () => {
    refetchPresence()
    refetchSchedulesRaw()
  }

  const presenceMapWithSelected = useMemo(() => {
    const hasSchedule = schedules.length > 0
    const hasOverdue = schedules.some((item) => item.state !== 'COMPLETED')
    return {
      ...presenceMap,
      [selectedDateKey]: { hasSchedule, hasOverdue },
    }
  }, [presenceMap, schedules, selectedDateKey])

  useEffect(() => {
    if (scheduleError) {
      addToast(scheduleError, 'error')
    }
  }, [addToast, scheduleError])

  const handleRefresh = () => {
    console.log('🔄 Manual refresh triggered')
    refetchPresence()
    refetchOverdue()
    refetchSchedules()
    refetchWeeklyStats()
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

  const handleStart = async (scheduleId: number) => {
    console.log(`▶️ Start schedule ${scheduleId}`)
    try {
      await startSchedule(scheduleId)
      console.log(`✅ Schedule started: ${scheduleId}`)
      refetchSchedules()
      refetchPresence()
    } catch (error) {
      console.error(`❌ Start failed for schedule ${scheduleId}:`, error)
      alert('일정 시작에 실패했습니다.')
    }
  }

  const handleCancel = async (scheduleId: number) => {
    console.log(`✕ Cancel schedule ${scheduleId}`)
    try {
      await cancelSchedule(scheduleId)
      console.log(`✅ Schedule cancelled: ${scheduleId}`)
      refetchSchedules()
      refetchPresence()
    } catch (error) {
      console.error(`❌ Cancel failed for schedule ${scheduleId}:`, error)
      alert('일정 취소에 실패했습니다.')
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
      <div className="week-transition" key={currentWeekStart.toISOString()}>
        <WeeklyDateStrip
          weekStart={currentWeekStart}
          selectedDate={selectedDate}
          presenceMap={presenceMapWithSelected}
          onSelectDate={selectDate}
          onChangeWeek={goToWeek}
        />
      </div>
      <div className="schedules-tab__weekly-stats week-transition" key={`${currentWeekStart.toISOString()}-stats`}>
        {isWeeklyStatsLoading ? (
          <span>이번 주 총 작업 시간을 불러오는 중...</span>
        ) : weeklyStatsError ? (
          <span>총 작업 시간을 표시할 수 없어요</span>
        ) : weeklyStats ? (
          <span>이번 주 총 작업 {formatMinutesToTime(weeklyStats.totalMinutes)}</span>
        ) : (
          <span>이번 주 총 작업 0시간 0분</span>
        )}
      </div>
      <header className="schedules-tab__header">
        <h2>{selectedDateLabel}</h2>
        <button type="button" className="schedules-tab__refresh" onClick={handleRefresh}>
          새로고침
        </button>
      </header>
      <div className="schedules-tab__list fade-slide">
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
                onStart={handleStart}
                onCancel={handleCancel}
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
