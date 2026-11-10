import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { getRequestFailureMessage } from '@shared/api/errorMessage'
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
import { CONFLICT_RELOADED, isEditConflict } from '@features/spaces/conflicts'
import {
  audienceSchedules,
  scheduleMineParam,
} from '@features/spaces/scope'
import {
  MOTION_ENTER_MS,
  prefersReducedMotion,
  presenceProps,
  useListPresence,
  usePresence,
  useTweenedNumber,
} from '@shared/motion'

type WeekDirection = 'forward' | 'backward'

/** The week total glides to a new value. Keyed by week, so another week's value never tweens into it. */
const WeeklyTotal = ({ minutes }: { minutes: number }) => {
  const shown = useTweenedNumber(minutes)
  return <>이번 주 총 작업 {formatMinutesToTime(Math.round(shown))}</>
}

/**
 * Day change: the new day's rows slide in from the side the day lies on, or rise in when they
 * replace a first load. Web Animations on the rows, so the list surface never fades or remounts.
 */
const animateDayRows = (root: HTMLElement | null, direction: -1 | 0 | 1) => {
  if (!root) return
  const reduce = prefersReducedMotion()
  const offset = reduce ? 'none' : direction === 0 ? 'translateY(8px)' : `translateX(${direction * 12}px)`
  root
    .querySelectorAll<HTMLElement>(':scope > .schedules-tab__item')
    .forEach((row, index) => {
      row.animate?.(
        [
          { opacity: 0, transform: offset },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: MOTION_ENTER_MS,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
          // A short stagger reads as one sweep; it stops growing after six rows.
          delay: reduce ? 0 : Math.min(index, 5) * 24,
          fill: 'backwards',
        },
      )
    })
}

const SchedulesTabPage = () => {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [movingScheduleId, setMovingScheduleId] = useState<number | null>(null)
  const recurrenceScope = useRecurrenceScope()
  const { open } = useRouteSurfaceNavigation()
  const [calendarView, setCalendarView] = useState<'week' | 'month'>('week')
  const {
    currentWeekStart,
    selectedDate,
    selectedDateLabel,
    selectedDateKey,
    goToWeek,
    selectDate,
  } = useScheduleViewState()
  // The week strip and the week total slide toward the week you moved to. Derived from the week
  // itself, so the arrows, a swipe, the month view and the overdue banner all agree, and nothing
  // slides on the first render.
  const weekKey = currentWeekStart.format('YYYY-MM-DD')
  const [weekNav, setWeekNav] = useState<{
    key: string
    direction: WeekDirection | null
  }>({ key: weekKey, direction: null })
  // What last changed the calendar: a week move slides it, a week/month switch fades it.
  const [calendarMotion, setCalendarMotion] = useState<'week' | 'view' | null>(
    null,
  )
  if (weekNav.key !== weekKey) {
    setWeekNav({
      key: weekKey,
      direction: weekKey > weekNav.key ? 'forward' : 'backward',
    })
    setCalendarMotion('week')
  }
  const weekTransition = weekNav.direction
    ? `week-transition week-transition--${weekNav.direction}`
    : ''
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
  const { memberId, selectedSpace, selectedProjectId } = useSpaces()
  const { audience, setAudience, shared } = useScheduleAudience()
  // 주간·월간 표시는 서버의 mine 조회를 쓴다. 전환이 없는 스페이스는 서버 기본 조회를 유지한다.
  const mine = scheduleMineParam(!shared, audience)
  // Keyed by week: picking another day in the same week reads nothing new.
  const {
    presenceMap,
    error: presenceError,
    refetch: refetchPresence,
  } = useWeeklySchedulePresence({
    weekStart: currentWeekStart,
    mine,
  })
  const monthly = useMonthlySchedules(
    selectedDate,
    calendarView === 'month',
    mine,
  )
  const {
    schedules: schedulesByDate,
    data: dayData,
    isLoading: isScheduleLoading,
    isRefreshing: isScheduleRefreshing,
    error: scheduleErrorRaw,
    refetch: refetchSchedulesRaw,
    setData: setDaySchedules,
  } = useScheduleList(selectedDate)
  // Rows exist for this day (fresh or refreshing). Only their absence shows a loading or error panel.
  const hasDayData = dayData !== undefined
  const { summary: overdueSummary, refetch: refetchOverdue } =
    useOverdueSchedulesSummary({ mine })
  // The banner rises in when overdue schedules appear and fades out when the last one is done.
  // One that is already known when the page mounts (from the cache) is simply there.
  const overdueBanner = usePresence(
    overdueSummary.hasOverdue ? overdueSummary : null,
  )
  const [bannerEnters, setBannerEnters] = useState(!overdueBanner.mounted)
  if (!bannerEnters && !overdueBanner.mounted) setBannerEnters(true)
  const statsWeekStart = useMemo(
    () => currentWeekStart.add(1, 'day'),
    [currentWeekStart],
  )
  const {
    current: weeklyStats,
    isLoading: isWeeklyStatsLoading,
    isRefreshing: isWeeklyStatsRefreshing,
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
  // The week dots failing never blanks the day list; it only raises a toast.
  const scheduleError = scheduleErrorRaw ?? presenceError
  const refetchSchedules = () => {
    refetchPresence()
    refetchSchedulesRaw()
    monthly.refetch()
  }

  // New rows rise in, removed rows fade out where they were. Another day, audience or space is a
  // new baseline: its rows arrive with the day transition instead.
  const rows = useListPresence(
    hasDayData ? schedules : undefined,
    (schedule) => schedule.id,
    {
      resetKey: `${selectedDateKey}|${audience}|${selectedSpace?.id ?? 'all'}|${selectedProjectId ?? 'all'}`,
    },
  )

  // The day the rows on screen belong to. undefined before the first commit.
  const shownDayRef = useRef<string | null | undefined>(undefined)
  useLayoutEffect(() => {
    const previous = shownDayRef.current
    if (!hasDayData) {
      if (previous === undefined) shownDayRef.current = null
      return
    }
    shownDayRef.current = selectedDateKey
    // First render with cached rows: the route already animates the page in.
    if (previous === undefined || previous === selectedDateKey) return
    animateDayRows(
      listRef.current,
      previous === null ? 0 : selectedDateKey > previous ? 1 : -1,
    )
  }, [hasDayData, selectedDateKey])

  const handleChangeWeek = (offset: 1 | -1) => goToWeek(offset)

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
  /** 다른 참여자가 먼저 바꿨으면 알리고 목록을 다시 받는다. 자동으로 다시 보내지 않는다. */
  const handleConflict = (error: unknown) => {
    if (!isEditConflict(error)) return false
    addToast(CONFLICT_RELOADED, 'error')
    handleRefresh()
    return true
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
            // The event also refreshes the overdue banner.
            dispatchScheduleChanged({ reason: 'recurrence' })
          }
        } catch (error) {
          console.error(
            `❌ Recurrence delete failed for schedule ${scheduleId}:`,
            error,
          )
          if (!handleConflict(error))
            addToast(
              getRequestFailureMessage(
                error,
                '반복 일정을 지우지 못했어요.',
              ),
              'error',
            )
        }
        return
      }
    }
    try {
      await deleteSchedule(scheduleId, target?.version)
      if (activeScheduleId === scheduleId) {
        setActiveSchedule(null)
      }
      // The row leaves at once (it fades out where it was), then one event refreshes the day,
      // the week dots, the month, the overdue banner and the week total.
      setDaySchedules((previous) =>
        (previous ?? []).filter((schedule) => schedule.id !== scheduleId),
      )
      dispatchScheduleChanged({ scheduleId, reason: 'deleted' })
      // Restoring dispatches its own change, which refreshes the same views.
      offerScheduleUndo(scheduleId)
    } catch (error) {
      console.error(`❌ Delete failed for schedule ${scheduleId}:`, error)
      if (!handleConflict(error))
        addToast(
          getRequestFailureMessage(
            error,
            '일정을 삭제하지 못했어요.',
          ),
          'error',
        )
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
      // The card leaves this day at once and fades out where it was.
      setDaySchedules((previous) =>
        (previous ?? []).filter((item) => item.id !== schedule.id),
      )
      // The event refreshes the day, week, month, overdue and stats views once. No extra refetch.
      dispatchScheduleChanged({
        schedule: updated,
        previousDateKey,
        reason: 'moved',
      })
      addToast(
        `"${schedule.title}" 일정을 ${offset < 0 ? '전날' : '다음날'}로 이동했어요.`,
        'success',
      )
    } catch (error) {
      console.error('❌ Failed to move schedule by one day:', error)
      if (!handleConflict(error))
        addToast(
          getRequestFailureMessage(
            error,
            '일정 날짜를 옮기지 못했어요.',
          ),
          'error',
        )
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
      // The handle keeps the new time while the day refreshes in the background. A shift past
      // midnight takes the card to another day, so it leaves this one like a move does.
      const staysOnDay = toDateKey(updated.date) === previousDateKey
      setDaySchedules((previous) =>
        staysOnDay
          ? (previous ?? []).map((item) => (item.id === updated.id ? updated : item))
          : (previous ?? []).filter((item) => item.id !== updated.id),
      )
      dispatchScheduleChanged({
        schedule: updated,
        previousDateKey,
        reason: 'moved',
      })
      addToast(
        `"${schedule.title}" 일정을 ${nextDate.format('HH:mm')}로 옮겼어요.`,
        'success',
      )
    } catch (error) {
      console.error('❌ Failed to shift schedule time:', error)
      if (!handleConflict(error))
        addToast(
          getRequestFailureMessage(
            error,
            '일정 시간을 옮기지 못했어요.',
          ),
          'error',
        )
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
    // Only a day with nothing to show blocks dragging. A refresh or a stale error does not.
    disabled: movingScheduleId !== null || !hasDayData,
    onMove: handleMoveSchedule,
    onRefresh: handleRefresh,
  })

  return (
    <section className="schedules-tab">
      {/* No loading panel here: it pushed the whole page down and back up on every change. */}
      {overdueBanner.mounted && overdueBanner.value && (
        <div
          className="schedules-tab__overdue"
          data-state={overdueBanner.closing ? 'closing' : undefined}
          data-enter={bannerEnters || undefined}
          inert={overdueBanner.closing || undefined}
        >
          <OverdueBanner
            summary={overdueBanner.value}
            onNavigateToDate={(dateKey) => {
              const targetDate = toDisplayDayjs(dateKey)
              selectDate(targetDate)
            }}
          />
        </div>
      )}
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
            onClick={() => {
              if (view !== calendarView) setCalendarMotion('view')
              setCalendarView(view)
            }}
          >
            {view === 'week' ? '주' : '월'}
          </button>
        ))}
      </div>
      {calendarView === 'month' ? (
        <div
          key="month"
          className={
            calendarMotion === 'view' ? 'schedules-tab__calendar-in' : undefined
          }
        >
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
        </div>
      ) : (
        <div
          className={
            calendarMotion === 'view'
              ? 'schedules-tab__calendar-in'
              : calendarMotion === 'week'
                ? weekTransition
                : undefined
          }
          key={weekKey}
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
        className={['schedules-tab__weekly-stats', weekTransition]
          .filter(Boolean)
          .join(' ')}
        key={`${weekKey}-stats`}
        aria-busy={isWeeklyStatsRefreshing || undefined}
      >
        {isWeeklyStatsLoading ? (
          // Invisible for the first 150ms, so a quick load goes straight to the total.
          <span className="schedules-tab__stats-pending">
            이번 주 총 작업 시간을 불러오는 중...
          </span>
        ) : weeklyStatsError ? (
          <span className="schedules-tab__stats-value">
            총 작업 시간을 표시할 수 없어요
          </span>
        ) : weeklyStats ? (
          <span className="schedules-tab__stats-value">
            <WeeklyTotal minutes={weeklyStats.totalMinutes} />
          </span>
        ) : (
          <span className="schedules-tab__stats-value">
            이번 주 총 작업 0시간 0분
          </span>
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
                data-schedule-audience={value}
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
        hasDayData && (
          <div className="schedules-tab__hidden-note" role="status">
            <span>
              이 날 다른 사람이 맡았거나 담당자가 없는 일정{' '}
              {hiddenScheduleCount}개는 숨겨져 있어요.
            </span>
            <button
              type="button"
              onClick={() => {
                setAudience('team')
                // 안내가 사라지므로 포커스를 범위 전환의 "팀 전체" 버튼으로 옮긴다.
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLButtonElement>(
                      '[data-schedule-audience="team"]',
                    )
                    ?.focus(),
                )
              }}
            >
              팀 전체 보기
            </button>
          </div>
        )}
      <div
        ref={listRef}
        // No mount animation on the list: it replayed on every visit. Days change with the
        // row transition in animateDayRows; refreshes leave the rows as they are.
        className="schedules-tab__list"
        aria-busy={isScheduleRefreshing || undefined}
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
        {isScheduleLoading ? (
          <StatusPanel variant="loading" title="일정을 불러오는 중" />
        ) : scheduleErrorRaw && !hasDayData ? (
          <StatusPanel
            variant="error"
            title="일정을 불러오지 못했어요"
            description={scheduleErrorRaw}
            action={<button onClick={refetchSchedules}>재시도</button>}
          />
        ) : rows.length ? (
          rows.map(({ key, item: schedule, phase }) => (
            <div
              key={key}
              className={[
                'schedules-tab__item',
                draggingScheduleId === schedule.id ? 'is-dragging' : '',
                movingScheduleId === schedule.id ? 'is-moving' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              {...presenceProps(phase)}
              {...(phase === 'exit' ? {} : getItemHandlers(schedule))}
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
            title={
              shared && audience === 'mine' && hiddenScheduleCount > 0
                ? '이 날 내 일정이 없어요'
                : '등록된 일정이 없어요'
            }
            description={
              shared && audience === 'mine' && hiddenScheduleCount > 0
                ? '팀 전체 보기에서 다른 사람의 일정을 볼 수 있어요.'
                : '일정 추가 탭에서 새로운 일정을 만들어보세요.'
            }
          />
        )}
      </div>

      {recurrenceScope.dialog}
    </section>
  )
}

export default SchedulesTabPage
