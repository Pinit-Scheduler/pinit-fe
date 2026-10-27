import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import useScheduleViewState from '../../hooks/useScheduleViewState.ts'
import WeeklyDateStrip from '../../components/WeeklyDateStrip.tsx'
import MonthCalendar from '../../components/MonthCalendar'
import useMonthlySchedules from '../../hooks/useMonthlySchedules'
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
import { addDays, getTodayWithOffset, toApiDateTimeWithZone, toDateKey, toDisplayDayjs } from '@shared/utils/datetime'
import { parseDateKey } from '@shared/utils/dateKey'
import { useToast } from '@contexts/ToastContext'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { useScheduleTaskSync } from '@shared/utils/scheduleTaskSync'
import { dispatchScheduleChanged } from '@shared/utils/events'
import useScheduleDrag from '../../hooks/useScheduleDrag'
import ScheduleTimeHandle from '../../components/ScheduleTimeHandle'
import { useRecurrenceScope } from '@features/recurrence/components/RecurrenceScopeDialog'
import { confirmAndDeleteSeries } from '@features/recurrence/utils/seriesMutations'
import { isBeyondGeneration } from '@features/recurrence/utils/recurrenceRules'

const SchedulesTabPage = () => {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [movingScheduleId, setMovingScheduleId] = useState<number | null>(null)
  const recurrenceScope = useRecurrenceScope()
  const [detailScheduleId, setDetailScheduleId] = useState<number | null>(null)
  const [weekDirection, setWeekDirection] = useState<'forward' | 'backward'>('forward')
  const [calendarView, setCalendarView] = useState<'week' | 'month'>('week')
  const {
    currentWeekStart,
    selectedDate,
    selectedDateLabel,
    selectedDateKey,
    goToWeek,
    selectDate,
  } = useScheduleViewState()
  const { offsetMinutes } = useTimePreferences()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedDateKey = searchParams.get('date')
  const appliedDateKeyRef = useRef<string | null>(null)

  // ?date=YYYY-MM-DD(예: 하루 계획 승인 후 링크)로 들어오면 그 날짜를 한 번 선택하고 쿼리를 지운다.
  // 쿼리를 남기면 이후 사용자가 고른 날짜를 덮어쓰게 된다. 잘못된 값은 무시해 기존 선택(오늘)을 유지한다.
  // 쿼리 삭제는 transition으로 늦게 반영되므로, 같은 값을 두 번 적용하지 않도록 ref로 막는다.
  useEffect(() => {
    if (requestedDateKey === null) {
      appliedDateKeyRef.current = null
      return
    }
    if (appliedDateKeyRef.current === requestedDateKey) return
    appliedDateKeyRef.current = requestedDateKey
    const parts = parseDateKey(requestedDateKey)
    if (parts) {
      selectDate(
        getTodayWithOffset(offsetMinutes)
          .date(1)
          .year(parts.year)
          .month(parts.month - 1)
          .date(parts.day),
      )
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('date')
        return next
      },
      { replace: true },
    )
  }, [requestedDateKey, offsetMinutes, selectDate, setSearchParams])
  const { addToast } = useToast()
  const { presenceMap, isLoading: isPresenceLoading, error: presenceError, refetch: refetchPresence } =
    useWeeklySchedulePresence({ weekStart: currentWeekStart, anchorDate: selectedDate })
  const monthly = useMonthlySchedules(selectedDate, calendarView === 'month')
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
    monthly.refetch()
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

  // 달을 넘기면 주간 이동처럼 선택 날짜도 같은 날로 옮긴다(없는 날은 그 달 말일).
  const handleChangeMonth = (offset: 1 | -1) => selectDate(selectedDate.add(offset, 'month'))

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
    // 반복 회차(ADR-0019)면 범위를 먼저 묻는다. 카드는 반복 회차의 삭제 확인을 이 화면에 맡긴다.
    const target = schedules.find((schedule) => schedule.id === scheduleId)
    if (target?.recurrence) {
      const scope = await recurrenceScope.ask('delete', target.title)
      if (scope === null) return
      if (scope !== 'THIS') {
        try {
          if (await confirmAndDeleteSeries(target.recurrence, scope)) {
            if (activeScheduleId === scheduleId) setActiveSchedule(null)
            dispatchScheduleChanged({ reason: 'recurrence' })
            refetchOverdue()
          }
        } catch (error) {
          console.error(`❌ Recurrence delete failed for schedule ${scheduleId}:`, error)
          addToast('반복 일정을 지우지 못했어요.', 'error')
        }
        return
      }
    }
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

  const handleShiftScheduleTime = async (schedule: ScheduleSummary, minutes: number) => {
    if (movingScheduleId === schedule.id) return
    const previousDateKey = toDateKey(schedule.date)
    setMovingScheduleId(schedule.id)
    try {
      const nextDate = toDisplayDayjs(schedule.date).add(minutes, 'minute')
      const updated = await updateSchedule(schedule.id, {
        date: toApiDateTimeWithZone(nextDate),
      })
      setSchedule(updated)
      dispatchScheduleChanged({ schedule: updated, previousDateKey, reason: 'moved' })
      refetchSchedules()
      addToast(`"${schedule.title}" 일정을 ${nextDate.format('HH:mm')}로 옮겼어요.`, 'success')
    } catch (error) {
      console.error('❌ Failed to shift schedule time:', error)
      addToast('일정 시간을 옮기지 못했어요.', 'error')
    } finally {
      setMovingScheduleId(null)
    }
  }

  const {
    edgeTarget,
    draggingScheduleId,
    getItemHandlers,
    containerTouchHandlers,
  } = useScheduleDrag({
    containerRef: listRef,
    hasItems: schedules.length > 0,
    onMove: handleMoveSchedule,
    onRefresh: handleRefresh,
  })

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
      <div className="schedules-tab__view-toggle" role="group" aria-label="달력 보기">
        {(['week', 'month'] as const).map((view) => (
          <button
            key={view}
            type="button"
            className={calendarView === view ? 'is-active' : undefined}
            aria-pressed={calendarView === view}
            onClick={() => setCalendarView(view)}
          >
            {view === 'week' ? '주' : '월'}
          </button>
        ))}
      </div>
      {calendarView === 'month' ? (
        <MonthCalendar
          month={selectedDate.startOf('month')}
          selectedDate={selectedDate}
          todayKey={toDateKey(getTodayWithOffset(offsetMinutes))}
          summaryByDate={monthly.summaryByDate}
          isLoading={monthly.isLoading}
          error={monthly.error}
          onSelectDate={selectDate}
          onChangeMonth={handleChangeMonth}
        />
      ) : (
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
      )}
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
      {isBeyondGeneration(selectedDateKey, getTodayWithOffset().format('YYYY-MM-DD')) && (
        <p className="schedules-tab__notice" role="note">
          🔁 반복 회차는 오늘부터 90일 앞까지만 보여요. 그 뒤의 회차는 날짜가 가까워지면 생겨요.
        </p>
      )}
      <header className="schedules-tab__header">
        <h2>{selectedDateLabel}</h2>
        <div className="schedules-tab__header-actions">
          <Link to={`/app/plan?date=${selectedDateKey}`} className="schedules-tab__refresh">
            자동 계획
          </Link>
          <button type="button" className="schedules-tab__refresh" onClick={handleRefresh}>
            새로고침
          </button>
        </div>
      </header>
      <div
        ref={listRef}
        className={['schedules-tab__list', 'fade-slide', `week-transition--${weekDirection}`].join(' ')}
        data-onboarding-anchor="schedules.list"
        onTouchStart={containerTouchHandlers.onTouchStart}
        onTouchMove={containerTouchHandlers.onTouchMove}
        onTouchEnd={containerTouchHandlers.onTouchEnd}
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
              {...getItemHandlers(schedule)}
            >
              <ScheduleTimeHandle
                start={toDisplayDayjs(schedule.date)}
                title={schedule.title}
                disabled={movingScheduleId === schedule.id}
                onCommit={(minutes) => void handleShiftScheduleTime(schedule, minutes)}
              />
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

      {recurrenceScope.dialog}
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
