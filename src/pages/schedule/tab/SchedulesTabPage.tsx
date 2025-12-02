import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import useScheduleViewState from '../../../hooks/useScheduleViewState.ts'
import WeeklyDateStrip from '../../../components/schedules/WeeklyDateStrip.tsx'
import OverdueBanner from '../../../components/schedules/OverdueBanner.tsx'
import useWeeklySchedulePresence from '../../../hooks/useWeeklySchedulePresence.ts'
import useOverdueSchedulesSummary from '../../../hooks/useOverdueSchedulesSummary.ts'
import ScheduleCard from '../../../components/schedules/ScheduleCard.tsx'
import useScheduleList from '../../../hooks/useScheduleList.ts'
import StatusPanel from '../../../components/common/StatusPanel.tsx'
import ScheduleDetailModal from '../../../components/modals/ScheduleDetailModal.tsx'
import {
  deleteSchedule,
  startSchedule,
  cancelSchedule,
  completeSchedule,
  fetchScheduleDetail,
} from '../../../api/schedules.ts'
import type { ScheduleResponse } from '../../../types/schedule'
import useWeeklyStatistics from '../../../hooks/useWeeklyStatistics.ts'
import { formatMinutesToTime } from '../../../utils/statisticsTransform.ts'
import './SchedulesTabPage.css'
import '../../../utils/datetime.ts'
import { useToast } from '../../../context/ToastContext'
import { useScheduleCache } from '../../../context/ScheduleCacheContext'
import { useRef } from 'react'

const SchedulesTabPage = () => {
  const listRef = useRef<HTMLDivElement | null>(null)
  const pullStartY = useRef<number | null>(null)
  const pullActivated = useRef(false)
  const [detailScheduleId, setDetailScheduleId] = useState<number | null>(null)
  const [weekDirection, setWeekDirection] = useState<'forward' | 'backward'>('forward')
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
  const statsWeekStart = useMemo(() => currentWeekStart.add(1, 'day'), [currentWeekStart])
  const {
    current: weeklyStats,
    isLoading: isWeeklyStatsLoading,
    error: weeklyStatsError,
    refetch: refetchWeeklyStats,
  } = useWeeklyStatistics({ weekStart: statsWeekStart })
  const {
    setSchedule,
    setActiveSchedule,
    updateScheduleState,
    activeScheduleId,
    schedulesById,
  } = useScheduleCache()

  const schedules = useMemo(
    () =>
      schedulesByDate.map((item) => {
        const cached = schedulesById[item.id]
        if (!cached) return item
        return { ...item, state: cached.state }
      }),
    [schedulesByDate, schedulesById],
  )
  const isScheduleLoading = isPresenceLoading || isScheduleLoadingRaw
  const scheduleError = scheduleErrorRaw ?? presenceError
  const refetchSchedules = () => {
    refetchPresence()
    refetchSchedulesRaw()
  }

  const handleChangeWeek = (offset: 1 | -1) => {
    setWeekDirection(offset > 0 ? 'forward' : 'backward')
    goToWeek(offset)
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

  useEffect(() => {
    schedulesByDate.forEach((schedule) => setSchedule(schedule as unknown as ScheduleResponse))
  }, [schedulesByDate, setSchedule])

  const handleRefresh = () => {
    console.log('🔄 Manual refresh triggered')
    refetchPresence()
    refetchOverdue()
    refetchSchedules()
    refetchWeeklyStats()
  }

  const handleDelete = async (scheduleId: number) => {
    console.log(`🗑️ Delete schedule ${scheduleId}`)
    try {
      await deleteSchedule(scheduleId)
      console.log(`✅ Schedule deleted: ${scheduleId}`)
      if (activeScheduleId === scheduleId) {
        setActiveSchedule(null)
      }
      refetchSchedules()
      refetchPresence()
    } catch (error) {
      console.error(`❌ Delete failed for schedule ${scheduleId}:`, error)
      addToast('일정 삭제에 실패했습니다.', 'error')
    }
  }

  const handleStart = async (scheduleId: number) => {
    console.log(`▶️ Start schedule ${scheduleId}`)
    try {
      await startSchedule(scheduleId)
      console.log(`✅ Schedule started: ${scheduleId}`)
      updateScheduleState(scheduleId, 'IN_PROGRESS')
      try {
        const detail = await fetchScheduleDetail(scheduleId)
        setSchedule(detail)
        setActiveSchedule(scheduleId)
        updateScheduleState(scheduleId, detail.state)
      } catch (error) {
        console.error('⚠️ Failed to cache active schedule detail after start:', error)
      }
      refetchSchedules()
      refetchPresence()
    } catch (error) {
      console.error(`❌ Start failed for schedule ${scheduleId}:`, error)
      addToast('일정 시작에 실패했습니다.', 'error')
    }
  }

  const handleCancel = async (scheduleId: number) => {
    console.log(`✕ Cancel schedule ${scheduleId}`)
    try {
      await cancelSchedule(scheduleId)
      console.log(`✅ Schedule cancelled: ${scheduleId}`)
      updateScheduleState(scheduleId, 'NOT_STARTED')
      if (activeScheduleId === scheduleId) {
        setActiveSchedule(null)
      }
      refetchSchedules()
      refetchPresence()
    } catch (error) {
      console.error(`❌ Cancel failed for schedule ${scheduleId}:`, error)
      addToast('일정 취소에 실패했습니다.', 'error')
    }
  }

  const handleComplete = async (scheduleId: number) => {
    console.log(`✅ Complete schedule ${scheduleId}`)
    try {
      await completeSchedule(scheduleId)
      updateScheduleState(scheduleId, 'COMPLETED')
      if (activeScheduleId === scheduleId) {
        setActiveSchedule(null)
      }
      try {
        const detail = await fetchScheduleDetail(scheduleId)
        setSchedule(detail)
        updateScheduleState(scheduleId, detail.state)
      } catch (error) {
        console.error('⚠️ Failed to refresh schedule detail after complete:', error)
      }
      refetchSchedules()
      refetchPresence()
    } catch (error) {
      console.error(`❌ Complete failed for schedule ${scheduleId}:`, error)
      addToast('일정 완료에 실패했습니다.', 'error')
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
      <div
        className={['week-transition', `week-transition--${weekDirection}`].join(' ')}
        key={currentWeekStart.toISOString()}
      >
        <WeeklyDateStrip
          weekStart={currentWeekStart}
          selectedDate={selectedDate}
          presenceMap={presenceMapWithSelected}
          onSelectDate={selectDate}
          onChangeWeek={handleChangeWeek}
        />
      </div>
      <div
        className={[
          'schedules-tab__weekly-stats',
          'week-transition',
          `week-transition--${weekDirection}`,
        ].join(' ')}
        key={`${currentWeekStart.toISOString()}-stats`}
      >
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
      <div
        ref={listRef}
        className={['schedules-tab__list', 'fade-slide', `week-transition--${weekDirection}`].join(' ')}
        onTouchStart={(e) => {
          if (!schedules.length) return
          pullStartY.current = e.touches[0].clientY
          pullActivated.current = false
        }}
        onTouchMove={(e) => {
          if (!schedules.length) return
          const container = listRef.current
          if (!container) return
          if (container.scrollTop > 0) {
            pullStartY.current = null
            pullActivated.current = false
            return
          }
          const startY = pullStartY.current ?? e.touches[0].clientY
          pullStartY.current = startY
          const deltaY = e.touches[0].clientY - startY
          if (deltaY > 60) {
            pullActivated.current = true
          }
        }}
        onTouchEnd={() => {
          if (pullActivated.current) {
            handleRefresh()
          }
          pullStartY.current = null
          pullActivated.current = false
        }}
      >
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
                onComplete={handleComplete}
                onCancel={handleCancel}
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
