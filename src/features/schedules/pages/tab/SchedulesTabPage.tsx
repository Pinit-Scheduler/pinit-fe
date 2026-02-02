import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import useScheduleViewState from '../../hooks/useScheduleViewState.ts'
import WeeklyDateStrip from '../../components/WeeklyDateStrip.tsx'
import OverdueBanner from '../../components/OverdueBanner.tsx'
import useWeeklySchedulePresence from '../../hooks/useWeeklySchedulePresence.ts'
import useOverdueSchedulesSummary from '../../hooks/useOverdueSchedulesSummary.ts'
import ScheduleCard from '../../components/ScheduleCard.tsx'
import useScheduleList from '../../hooks/useScheduleList.ts'
import StatusPanel from '@shared/components/common/StatusPanel'
import ScheduleDetailModal from '../../components/modals/ScheduleDetailModal.tsx'
import {
  deleteSchedule,
  startSchedule,
  cancelSchedule,
  completeSchedule,
  fetchScheduleDetail,
  updateSchedule,
} from '../../api/schedules.ts'
import type { ScheduleResponse, ScheduleSummary } from '../../types/schedule'
import useWeeklyStatistics from '@features/statistics/hooks/useWeeklyStatistics'
import { formatMinutesToTime } from '@shared/utils/statisticsTransform'
import './SchedulesTabPage.css'
import { addDays, toApiDateTimeWithZone, toDateKey, toDisplayDayjs } from '@shared/utils/datetime'
import { useToast } from '@contexts/ToastContext'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import { useScheduleTaskSync } from '@shared/utils/scheduleTaskSync'
import { dispatchScheduleChanged } from '@shared/utils/events'

const EDGE_GUTTER = 72
const DRAG_ACTIVATE_DISTANCE = 6

const SchedulesTabPage = () => {
  const listRef = useRef<HTMLDivElement | null>(null)
  const pullStartY = useRef<number | null>(null)
  const pullActivated = useRef(false)
  const dragStateRef = useRef<{ id: number; startX: number; startY: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const [draggingScheduleId, setDraggingScheduleId] = useState<number | null>(null)
  const [edgeTarget, setEdgeTarget] = useState<'prev' | 'next' | null>(null)
  const [movingScheduleId, setMovingScheduleId] = useState<number | null>(null)
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
  const { syncTaskStateWithSchedule } = useScheduleTaskSync()

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

  const refreshScheduleDetail = async (
    scheduleId: number,
    syncState?: ScheduleResponse['state'],
  ): Promise<ScheduleResponse | null> => {
    try {
      const detail = await fetchScheduleDetail(scheduleId)
      setSchedule(detail)
      updateScheduleState(scheduleId, detail.state)
      if (detail.taskId != null) {
        await syncTaskStateWithSchedule(detail.taskId, syncState ?? detail.state)
      }
      return detail
    } catch (error) {
      console.error('Failed to refresh schedule detail:', error)
      return null
    }
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
    refetchOverdue()
    refetchSchedules()
    refetchWeeklyStats()
  }

  const handleDelete = async (scheduleId: number) => {
    try {
      await deleteSchedule(scheduleId)
      if (activeScheduleId === scheduleId) {
        setActiveSchedule(null)
      }
      refetchSchedules()
      refetchOverdue()
    } catch (error) {
      console.error(`❌ Delete failed for schedule ${scheduleId}:`, error)
      addToast('일정 삭제에 실패했습니다.', 'error')
    }
  }

  const handleStart = async (scheduleId: number) => {
    try {
      await startSchedule(scheduleId)
      updateScheduleState(scheduleId, 'IN_PROGRESS')
      const detail = await refreshScheduleDetail(scheduleId, 'IN_PROGRESS')
      if (detail) {
        setActiveSchedule(scheduleId)
      }
      refetchSchedules()
    } catch (error) {
      console.error(`❌ Start failed for schedule ${scheduleId}:`, error)
      addToast('일정 시작에 실패했습니다.', 'error')
    }
  }

  const handleCancel = async (scheduleId: number) => {
    try {
      await cancelSchedule(scheduleId)
      updateScheduleState(scheduleId, 'NOT_STARTED')
      if (activeScheduleId === scheduleId) {
        setActiveSchedule(null)
      }
      await refreshScheduleDetail(scheduleId, 'NOT_STARTED')
      refetchSchedules()
    } catch (error) {
      console.error(`❌ Cancel failed for schedule ${scheduleId}:`, error)
      addToast('일정 취소에 실패했습니다.', 'error')
    }
  }

  const handleComplete = async (scheduleId: number) => {
    try {
      await completeSchedule(scheduleId)
      updateScheduleState(scheduleId, 'COMPLETED')
      if (activeScheduleId === scheduleId) {
        setActiveSchedule(null)
      }
      await refreshScheduleDetail(scheduleId, 'COMPLETED')
      refetchSchedules()
      refetchOverdue()
    } catch (error) {
      console.error(`❌ Complete failed for schedule ${scheduleId}:`, error)
      addToast('일정 완료에 실패했습니다.', 'error')
    }
  }

  const handleMoveSchedule = async (schedule: ScheduleSummary, offset: 1 | -1) => {
    if (movingScheduleId === schedule.id) return
    const previousDateKey = toDateKey(schedule.date)
    setMovingScheduleId(schedule.id)
    try {
      const nextDate = addDays(schedule.date, offset)
      const updated = await updateSchedule(schedule.id, {
        date: toApiDateTimeWithZone(nextDate),
      })
      setSchedule(updated)
      dispatchScheduleChanged({ schedule: updated, previousDateKey, reason: 'moved' })
      refetchSchedules()
      refetchOverdue()
      refetchWeeklyStats()
      addToast(
        `"${schedule.title}" 일정을 ${offset < 0 ? '전날' : '다음날'}로 이동했어요.`,
        'success',
      )
    } catch (error) {
      console.error('❌ Failed to move schedule by one day:', error)
      addToast('일정 날짜를 이동하지 못했어요.', 'error')
    } finally {
      setMovingScheduleId(null)
    }
  }

  const resetDragState = () => {
    dragStateRef.current = null
    setDraggingScheduleId(null)
    setEdgeTarget(null)
  }

  const handleDragStart = (event: PointerEvent<HTMLDivElement>, scheduleId: number) => {
    dragStateRef.current = {
      id: scheduleId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
    suppressClickRef.current = false
    setDraggingScheduleId(scheduleId)
    setEdgeTarget(null)
  }

  const handleDragMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current
    if (!state) return
    const deltaX = event.clientX - state.startX
    const deltaY = event.clientY - state.startY
    if (!state.moved && Math.abs(deltaX) + Math.abs(deltaY) > DRAG_ACTIVATE_DISTANCE) {
      state.moved = true
    }
    const viewportWidth = window.innerWidth
    const nextTarget =
      event.clientX < EDGE_GUTTER
        ? 'prev'
        : event.clientX > viewportWidth - EDGE_GUTTER
          ? 'next'
          : null
    setEdgeTarget(nextTarget)
  }

  const handleDragEnd = (event: PointerEvent<HTMLDivElement>, schedule: ScheduleSummary) => {
    const state = dragStateRef.current
    if (!state || state.id !== schedule.id) {
      resetDragState()
      return
    }
    const target = edgeTarget
    if (state.moved) {
      event.preventDefault()
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 300)
    }
    resetDragState()
    if (target) {
      handleMoveSchedule(schedule, target === 'prev' ? -1 : 1)
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
            const targetDate = toDisplayDayjs(dateKey)
            selectDate(targetDate)
          }}
        />
      ) : null}
      <div
        className={['week-transition', `week-transition--${weekDirection}`].join(' ')}
        key={currentWeekStart.format('YYYY-MM-DD')}
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
        key={`${currentWeekStart.format('YYYY-MM-DD')}-stats`}
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
        <div
          className={[
            'schedules-tab__edge',
            'schedules-tab__edge--left',
            draggingScheduleId ? 'is-visible' : '',
            edgeTarget === 'prev' ? 'is-active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-hidden
        >
          <span>전날로 이동</span>
        </div>
        <div
          className={[
            'schedules-tab__edge',
            'schedules-tab__edge--right',
            draggingScheduleId ? 'is-visible' : '',
            edgeTarget === 'next' ? 'is-active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-hidden
        >
          <span>다음날로 이동</span>
        </div>
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
            <div
              key={schedule.id}
              className={[
                'schedules-tab__item',
                draggingScheduleId === schedule.id ? 'is-dragging' : '',
                movingScheduleId === schedule.id ? 'is-moving' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onPointerDown={(event) => handleDragStart(event, schedule.id)}
              onPointerMove={handleDragMove}
              onPointerUp={(event) => handleDragEnd(event, schedule)}
              onPointerCancel={() => resetDragState()}
              onPointerLeave={() => resetDragState()}
              onClickCapture={(event) => {
                if (suppressClickRef.current) {
                  event.stopPropagation()
                  event.preventDefault()
                  suppressClickRef.current = false
                }
              }}
            >
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
          onRefresh={() => {
            refetchSchedules()
            refetchOverdue()
          }}
        />
      )}
    </section>
  )
}

export default SchedulesTabPage
