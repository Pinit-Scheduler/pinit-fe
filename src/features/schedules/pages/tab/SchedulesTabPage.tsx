import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
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
import useScheduleAudience from '../../hooks/useScheduleAudience'
import StatusPanel from '@shared/components/common/StatusPanel'
import { useRouteSurfaceNavigation } from '@shared/routing/RouteSurface'
import { deleteSchedule, updateSchedule } from '../../api/schedules.ts'
import type { ScheduleResponse, ScheduleSummary } from '../../types/schedule'
import useWeeklyStatistics from '@features/statistics/hooks/useWeeklyStatistics'
import { formatMinutesToTime } from '@shared/utils/statisticsTransform'
import './SchedulesTabPage.css'
import {
  addDays,
  getTodayWithOffset,
  toApiDateTimeWithZone,
  toDateKey,
  toDisplayDayjs,
} from '@shared/utils/datetime'
import { parseDateKey } from '@shared/utils/dateKey'
import { useToast } from '@contexts/ToastContext'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { dispatchScheduleChanged } from '@shared/utils/events'
import { useTrashUndo } from '@features/trash'
import useScheduleDrag from '../../hooks/useScheduleDrag'
import ScheduleTimeHandle from '../../components/ScheduleTimeHandle'
import { useRecurrenceScope } from '@features/recurrence/components/RecurrenceScopeDialog'
import {
  confirmAndDeleteSeries,
  previewSeriesDelete,
} from '@features/recurrence/utils/seriesMutations'
import { isBeyondGeneration } from '@features/recurrence/utils/recurrenceRules'
import { useSpaces } from '@features/spaces/store'
import {
  audienceSchedules,
  scheduleMineParam,
} from '@features/spaces/scope'

const SchedulesTabPage = () => {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [movingScheduleId, setMovingScheduleId] = useState<number | null>(null)
  const recurrenceScope = useRecurrenceScope()
  const { open } = useRouteSurfaceNavigation()
  const [weekDirection, setWeekDirection] = useState<'forward' | 'backward'>(
    'forward',
  )
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
  const { offerScheduleUndo } = useTrashUndo()
  const { memberId, selectedSpace } = useSpaces()
  const { audience, setAudience, shared } = useScheduleAudience()
  // 주간·월간 표시는 서버의 mine 조회를 쓴다. 전환이 없는 스페이스는 서버 기본 조회를 유지한다.
  const mine = scheduleMineParam(!shared, audience)
  const {
    presenceMap,
    isLoading: isPresenceLoading,
    error: presenceError,
    refetch: refetchPresence,
  } = useWeeklySchedulePresence({
    weekStart: currentWeekStart,
    anchorDate: selectedDate,
    mine,
  })
  const monthly = useMonthlySchedules(
    selectedDate,
    calendarView === 'month',
    mine,
  )
  const {
    schedules: schedulesByDate,
    isLoading: isScheduleLoadingRaw,
    error: scheduleErrorRaw,
    refetch: refetchSchedulesRaw,
  } = useScheduleList(selectedDate)
  const {
    summary: overdueSummary,
    isLoading: isOverdueLoading,
    refetch: refetchOverdue,
  } = useOverdueSchedulesSummary()
  const statsWeekStart = useMemo(
    () => currentWeekStart.add(1, 'day'),
    [currentWeekStart],
  )
  const {
    current: weeklyStats,
    isLoading: isWeeklyStatsLoading,
    error: weeklyStatsError,
    refetch: refetchWeeklyStats,
  } = useWeeklyStatistics({ weekStart: statsWeekStart })
  const { setSchedule, setActiveSchedule, activeScheduleId, schedulesById } =
    useScheduleCache()

  const daySchedules = useMemo(
    () =>
      schedulesByDate.map((item) => {
        const cached = schedulesById[item.id]
        if (!cached) return item
        return { ...item, state: cached.state }
      }),
    [schedulesByDate, schedulesById],
  )
  // 날짜별 목록은 팀 전체를 받아 내 일정 보기에서 내가 담당자인 일정만 보여 준다(서버 mine=true와 같은 기준).
  const { visible: schedules, hidden: hiddenScheduleCount } = useMemo(
    () => audienceSchedules(daySchedules, shared, audience, memberId),
    [daySchedules, shared, audience, memberId],
  )
  const showsAssignee = shared && audience === 'team'
  const assigneeOf = (schedule: ScheduleSummary) => {
    if (schedule.assigneeId === null)
      return { label: '담당자 미정', unassigned: true }
    const label =
      schedule.assigneeNickname ||
      selectedSpace?.members.find(
        (member) => member.memberId === schedule.assigneeId,
      )?.nickname
    return label ? { label, unassigned: false } : null
  }
  const isScheduleLoading = isPresenceLoading || isScheduleLoadingRaw
  const scheduleError = scheduleErrorRaw ?? presenceError
  const refetchSchedules = () => {
    refetchPresence()
    refetchSchedulesRaw()
    monthly.refetch()
  }

  const handleChangeWeek = (offset: 1 | -1) => {
    setWeekDirection(offset > 0 ? 'forward' : 'backward')
    goToWeek(offset)
  }

  // 달을 넘기면 주간 이동처럼 선택 날짜도 같은 날로 옮긴다(없는 날은 그 달 말일).
  const handleChangeMonth = (offset: 1 | -1) =>
    selectDate(selectedDate.add(offset, 'month'))

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
    schedulesByDate.forEach((schedule) =>
      setSchedule(schedule as unknown as ScheduleResponse),
    )
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
      const scope = await recurrenceScope.ask('delete', target.title, {
        preview: (selected) =>
          selected === 'THIS'
            ? Promise.resolve(
                '이번 회차만 휴지통으로 옮겨요. 30일 안에 되돌릴 수 있어요.',
              )
            : previewSeriesDelete(target.recurrence!, selected),
      })
      if (scope === null) return
      if (scope !== 'THIS') {
        try {
          if (await confirmAndDeleteSeries(target.recurrence, scope, true)) {
            if (activeScheduleId === scheduleId) setActiveSchedule(null)
            dispatchScheduleChanged({ reason: 'recurrence' })
            refetchOverdue()
          }
        } catch (error) {
          console.error(
            `❌ Recurrence delete failed for schedule ${scheduleId}:`,
            error,
          )
          addToast('반복 일정을 지우지 못했어요.', 'error')
        }
        return
      }
    }
    try {
      await deleteSchedule(scheduleId, target?.version)
      if (activeScheduleId === scheduleId) {
        setActiveSchedule(null)
      }
      refetchSchedules()
      refetchOverdue()
      offerScheduleUndo(scheduleId, () => {
        refetchSchedules()
        refetchOverdue()
      })
    } catch (error) {
      console.error(`❌ Delete failed for schedule ${scheduleId}:`, error)
      addToast('일정 삭제에 실패했습니다.', 'error')
    }
  }

  const handleMoveSchedule = async (
    schedule: ScheduleSummary,
    offset: 1 | -1,
  ) => {
    if (movingScheduleId === schedule.id || !schedule.allowedActions?.edit)
      return
    const previousDateKey = toDateKey(schedule.date)
    setMovingScheduleId(schedule.id)
    try {
      const nextDate = addDays(schedule.date, offset)
      const updated = await updateSchedule(schedule.id, {
        date: toApiDateTimeWithZone(nextDate),
        expectedVersion: schedule.version,
      })
      setSchedule(updated)
      dispatchScheduleChanged({
        schedule: updated,
        previousDateKey,
        reason: 'moved',
      })
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

  const handleShiftScheduleTime = async (
    schedule: ScheduleSummary,
    minutes: number,
  ) => {
    if (movingScheduleId === schedule.id || !schedule.allowedActions?.edit)
      return
    const previousDateKey = toDateKey(schedule.date)
    setMovingScheduleId(schedule.id)
    try {
      const nextDate = toDisplayDayjs(schedule.date).add(minutes, 'minute')
      const updated = await updateSchedule(schedule.id, {
        date: toApiDateTimeWithZone(nextDate),
        expectedVersion: schedule.version,
      })
      setSchedule(updated)
      dispatchScheduleChanged({
        schedule: updated,
        previousDateKey,
        reason: 'moved',
      })
      refetchSchedules()
      addToast(
        `"${schedule.title}" 일정을 ${nextDate.format('HH:mm')}로 옮겼어요.`,
        'success',
      )
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
    resetKey: selectedDateKey,
    disabled: movingScheduleId !== null || isScheduleLoading || !!scheduleError,
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
      <div
        className="schedules-tab__view-toggle"
        role="group"
        aria-label="달력 보기"
      >
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
          className={[
            'week-transition',
            `week-transition--${weekDirection}`,
          ].join(' ')}
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
          <span>
            이번 주 총 작업 {formatMinutesToTime(weeklyStats.totalMinutes)}
          </span>
        ) : (
          <span>이번 주 총 작업 0시간 0분</span>
        )}
      </div>
      {isBeyondGeneration(
        selectedDateKey,
        getTodayWithOffset().format('YYYY-MM-DD'),
      ) && (
        <p className="schedules-tab__notice" role="note">
          <WorkspaceIcon name="repeat" /> 반복 회차는 오늘부터 90일 앞까지만
          보여요. 그 뒤의 회차는 날짜가 가까워지면 생겨요.
        </p>
      )}
      <header className="schedules-tab__header">
        <h2>{selectedDateLabel}</h2>
        {shared && (
          <div
            className="schedules-tab__audience"
            role="group"
            aria-label="일정 보기 범위"
          >
            {(['mine', 'team'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={audience === value}
                onClick={() => setAudience(value)}
              >
                {value === 'mine' ? '내 일정' : '팀 전체'}
              </button>
            ))}
          </div>
        )}
        <div className="schedules-tab__header-actions">
          <button
            type="button"
            className="schedules-tab__create"
            onClick={() =>
              open('/app/schedules/new', {
                state: { initialDateKey: selectedDateKey },
              })
            }
          >
            + 일정 추가
          </button>
          <Link
            to={`/app/plan?date=${selectedDateKey}`}
            className="schedules-tab__refresh"
          >
            자동 계획
          </Link>
          <button
            type="button"
            className="schedules-tab__refresh"
            onClick={handleRefresh}
          >
            새로고침
          </button>
        </div>
      </header>
      <p className="schedules-tab__drag-hint">
        카드를 좌우 끝으로 끌면 전날·다음날로 이동해요. 시각 손잡이는 위아래로
        끌어 시간을 바꿔요.
      </p>
      {shared &&
        audience === 'mine' &&
        hiddenScheduleCount > 0 &&
        !isScheduleLoading &&
        !scheduleError && (
          <div className="schedules-tab__hidden-note">
            <span>
              이 날 팀원 일정 {hiddenScheduleCount}개는 숨겨져 있어요.
            </span>
            <button type="button" onClick={() => setAudience('team')}>
              팀 전체 보기
            </button>
          </div>
        )}
      <div
        ref={listRef}
        className={[
          'schedules-tab__list',
          'fade-slide',
          `week-transition--${weekDirection}`,
        ].join(' ')}
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
                onCommit={(minutes) =>
                  void handleShiftScheduleTime(schedule, minutes)
                }
              />
              <ScheduleCard
                schedule={schedule}
                onOpenDetail={(id) => open(`/app/schedules/${id}`)}
                onDelete={handleDelete}
                assignee={showsAssignee ? assigneeOf(schedule) : null}
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
    </section>
  )
}

export default SchedulesTabPage
