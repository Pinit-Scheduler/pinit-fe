import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { ApiError } from '@shared/api/httpClient'
import { getTodayWithOffset } from '@shared/utils/datetime'
import { dispatchScheduleChanged, dispatchTaskChanged } from '@shared/utils/events'
import { formatIsoDurationLabel, formatMinutesLabel, parseIsoDurationMinutes } from '@shared/utils/isoDuration'
import { NUDGE_KEYS, readFlag, writeFlag } from '@shared/utils/safeStorage'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { useToast } from '@contexts/ToastContext'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import { scheduleTypeLabel } from '@constants/schedules'
import type { ScheduleResponse, ScheduleTaskType } from '@features/schedules/types/schedule'
import { fetchRoutines } from '@features/routines/api/routines'
import type { RoutineKind } from '@features/routines/types/routine'
import { KIND_LABEL, mealHintFor, routineName } from '@features/routines/utils/routineRules'
import { applyDayPlan } from '../api/plans'
import useDayPlan from '../hooks/useDayPlan'
import PlanTimeline from '../components/PlanTimeline'
import type { PlanTimelineItem } from '../components/PlanTimeline'
import type { PlanApplyBlock, PlannedBlock } from '../types/plan'
import {
  MAX_APPLY_BLOCKS,
  findRoutineConflicts,
  mapRejectionsToBlocks,
  parsePlanRejections,
  unplacedReasonLabel,
  validatePlanSelection,
} from '../utils/planMapping'
import type { BlockIssue, RoutineSpan, SelectionObstacle } from '../utils/planMapping'
import './PlanPage.css'

type DraftBlock = {
  taskId: number
  title: string
  /** 제안이 정한 길이. 승인 전 수정할 수 없다 */
  durationMinutes: number
  mustTier: boolean
  selected: boolean
  /** datetime-local 값(YYYY-MM-DDTHH:mm), 계획 시간대 기준 */
  startLocal: string
  scheduleType: ScheduleTaskType
  suggestedStartLocal: string
  suggestedType: ScheduleTaskType
}

const HORIZON_OPTIONS = [0, 1, 3, 7, 14, 30]
const DEFAULT_HORIZON_DAYS = 7
const SCHEDULE_TYPES = Object.keys(scheduleTypeLabel) as ScheduleTaskType[]
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 계획 시간대의 로컬 시각 문자열을 epoch ms로. 읽을 수 없으면 null */
const toMs = (localDateTime: string, zoneId: string): number | null => {
  if (!localDateTime) return null
  try {
    const parsed = dayjs.tz(localDateTime, zoneId)
    return parsed.isValid() ? parsed.valueOf() : null
  } catch {
    return null
  }
}

const toDraft = (block: PlannedBlock, zoneId: string): DraftBlock => {
  const startLocal = block.start.dateTime.slice(0, 16)
  const startMs = toMs(block.start.dateTime, block.start.zoneId || zoneId) ?? 0
  const endMs = toMs(block.end.dateTime, block.end.zoneId || zoneId) ?? startMs
  return {
    taskId: block.taskId,
    title: block.title,
    durationMinutes: parseIsoDurationMinutes(block.duration) ?? Math.round((endMs - startMs) / 60000),
    mustTier: block.mustTier,
    selected: true,
    startLocal,
    scheduleType: block.scheduleType,
    suggestedStartLocal: startLocal,
    suggestedType: block.scheduleType,
  }
}

const scheduleSpan = (schedule: ScheduleResponse) => {
  const startMs = toMs(schedule.date.dateTime, schedule.date.zoneId)
  if (startMs === null) return null
  // 계획 길이를 모르는 응답이면 서버의 Task 없는 일정 기본값(30분)으로 그린다.
  const minutes = parseIsoDurationMinutes(schedule.plannedDuration) ?? 30
  return { startMs, endMs: startMs + minutes * 60000 }
}

const PlanPage = () => {
  const { offsetMinutes, zoneId } = useTimePreferences()
  const { addToast } = useToast()
  const { upsertSchedule } = useScheduleCache()
  const [searchParams, setSearchParams] = useSearchParams()
  const today = useMemo(() => getTodayWithOffset(offsetMinutes).format('YYYY-MM-DD'), [offsetMinutes])

  const requestedDate = searchParams.get('date')
  const date = requestedDate && DATE_PATTERN.test(requestedDate) && requestedDate >= today ? requestedDate : today
  const [horizonDays, setHorizonDays] = useState(DEFAULT_HORIZON_DAYS)
  const [refreshKey, setRefreshKey] = useState(0)
  const { plan, schedules, isLoading, error } = useDayPlan({ date, zoneId, horizonDays, refreshKey })

  const [drafts, setDrafts] = useState<DraftBlock[]>([])
  const [serverIssues, setServerIssues] = useState<Record<number, BlockIssue[]>>({})
  const [applyError, setApplyError] = useState<string | null>(null)
  const [isApplying, setIsApplying] = useState(false)
  /** 승인으로 만든 일정과 그 계획일 */
  const [created, setCreated] = useState<{ date: string; schedules: ScheduleResponse[] } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  /** 등록한 생활 시간 수. 모르면(불러오기 실패) null이고 안내 카드를 띄우지 않는다 */
  const [routineCount, setRoutineCount] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState(() => ({
    routinesCard: readFlag(NUDGE_KEYS.planRoutinesCardDismissed),
    mealHint: readFlag(NUDGE_KEYS.planMealHintDismissed),
    windowHint: readFlag(NUDGE_KEYS.planWindowHintDismissed),
  }))

  const dismiss = (name: keyof typeof dismissed, key: string) => {
    writeFlag(key)
    setDismissed((prev) => ({ ...prev, [name]: true }))
  }

  useEffect(() => {
    let cancelled = false
    fetchRoutines()
      .then((response) => {
        if (!cancelled) setRoutineCount(response?.routines?.length ?? 0)
      })
      .catch(() => {
        if (!cancelled) setRoutineCount(null)
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  // 새 제안을 받으면 편집 상태를 제안 그대로 되돌린다.
  useEffect(() => {
    setDrafts(plan ? plan.blocks.map((block) => toDraft(block, plan.zoneId)) : [])
    setServerIssues({})
    setApplyError(null)
  }, [plan])

  useEffect(() => {
    setCreated(null)
  }, [date])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const planZoneId = plan?.zoneId ?? zoneId

  const obstacles = useMemo<SelectionObstacle[]>(
    () =>
      schedules.flatMap((schedule) => {
        // 진행 중 일정의 점유(지금 + 남은 시간)는 서버만 정확히 안다. 승인할 때 서버가 검사한다.
        if (schedule.state === 'IN_PROGRESS') return []
        const span = scheduleSpan(schedule)
        return span ? [{ title: schedule.title, ...span }] : []
      }),
    [schedules],
  )

  const draftSpans = useMemo(
    () =>
      drafts.map((draft) => {
        const startMs = toMs(draft.startLocal, planZoneId)
        return { draft, startMs, endMs: startMs === null ? null : startMs + draft.durationMinutes * 60000 }
      }),
    [drafts, planZoneId],
  )

  const selectedSpans = useMemo(() => draftSpans.filter(({ draft }) => draft.selected), [draftSpans])

  const clientIssues = useMemo(
    () =>
      validatePlanSelection(
        selectedSpans.map(({ draft, startMs, endMs }) => ({ taskId: draft.taskId, title: draft.title, startMs, endMs })),
        obstacles,
        now,
      ),
    [selectedSpans, obstacles, now],
  )

  // ADR-0016: 생활 시간 구간. 서버는 승인 때 검사하지 않으므로 겹치면 경고만 한다.
  const routineSpans = useMemo<(RoutineSpan & { key: string; kind: RoutineKind })[]>(
    () =>
      (plan?.routines ?? []).flatMap((routine, index) => {
        const startMs = toMs(routine.start.dateTime, routine.start.zoneId)
        const endMs = toMs(routine.end.dateTime, routine.end.zoneId)
        if (startMs === null || endMs === null) return []
        return [{ key: `routine-${routine.routineId}-${index}`, kind: routine.kind, name: routineName(routine), startMs, endMs }]
      }),
    [plan],
  )

  const routineWarnings = useMemo(
    () =>
      findRoutineConflicts(
        selectedSpans.map(({ draft, startMs, endMs }) => ({ taskId: draft.taskId, title: draft.title, startMs, endMs })),
        routineSpans,
      ),
    [selectedSpans, routineSpans],
  )

  const registeredKinds = useMemo(() => new Set(routineSpans.map((routine) => routine.kind)), [routineSpans])
  const planDayStartMs = plan ? toMs(`${plan.date}T00:00:00`, plan.zoneId) : null

  const selectedCount = selectedSpans.length
  const selectedMinutes = selectedSpans.reduce((sum, { draft }) => sum + draft.durationMinutes, 0)
  const hasClientIssues = selectedSpans.some(({ draft }) => (clientIssues[draft.taskId]?.length ?? 0) > 0)
  const tooMany = selectedCount > MAX_APPLY_BLOCKS
  const canApply = selectedCount > 0 && !hasClientIssues && !tooMany && !isApplying

  const updateDraft = (taskId: number, patch: Partial<DraftBlock>) => {
    setDrafts((prev) => prev.map((draft) => (draft.taskId === taskId ? { ...draft, ...patch } : draft)))
    // 고친 블록의 지난 거부 사유는 지운다. 다시 승인하면 서버가 새로 판단한다.
    setServerIssues((prev) => {
      if (!prev[taskId]) return prev
      const next = { ...prev }
      delete next[taskId]
      return next
    })
  }

  const setAllSelected = (selected: boolean) => {
    setDrafts((prev) => prev.map((draft) => ({ ...draft, selected })))
  }

  const handleDateChange = (value: string) => {
    if (!value) return
    if (value < today) {
      addToast('지난 날짜는 계획할 수 없어요.', 'error')
      return
    }
    setSearchParams(value === today ? {} : { date: value }, { replace: true })
  }

  const handleApply = async () => {
    if (!plan || !canApply) return
    const submitted = drafts.filter((draft) => draft.selected)
    const blocks: PlanApplyBlock[] = submitted.map((draft) => ({
      taskId: draft.taskId,
      startTime: `${draft.startLocal}:00`,
      scheduleType: draft.scheduleType,
    }))
    setIsApplying(true)
    setApplyError(null)
    setServerIssues({})
    try {
      const response = await applyDayPlan({ date: plan.date, zoneId: plan.zoneId, blocks })
      const schedulesCreated = response?.schedules ?? []
      schedulesCreated.forEach((schedule) => {
        upsertSchedule(schedule)
        dispatchScheduleChanged({ schedule, reason: 'plan-applied' })
      })
      submitted.forEach((draft) => dispatchTaskChanged({ taskId: draft.taskId, reason: 'plan-applied' }))
      setCreated({ date: plan.date, schedules: schedulesCreated })
      addToast(`${schedulesCreated.length}개 일정을 만들었어요.`, 'success')
      setRefreshKey((key) => key + 1)
    } catch (err) {
      const rejections = err instanceof ApiError && err.status === 409 ? parsePlanRejections(err.data) : null
      if (rejections) {
        setServerIssues(mapRejectionsToBlocks(rejections, submitted.map((draft) => draft.taskId)))
        setApplyError('일정은 하나도 만들어지지 않았어요. 표시된 블록을 고치거나 선택을 빼고 다시 승인해 주세요.')
        addToast('승인하지 못했어요. 표시된 블록을 확인해 주세요.', 'error')
      } else {
        const message = err instanceof Error ? err.message : '계획을 승인하지 못했어요.'
        setApplyError(`승인하지 못했어요. ${message}`)
        addToast('계획을 승인하지 못했어요.', 'error')
      }
    } finally {
      setIsApplying(false)
    }
  }

  const scrollToBlock = (key: string) => {
    document.getElementById(`plan-block-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const windowStartMs = plan ? toMs(plan.window.start.dateTime, plan.window.start.zoneId) : null
  const windowEndMs = plan ? toMs(plan.window.end.dateTime, plan.window.end.zoneId) : null
  const isWindowEmpty = windowStartMs !== null && windowEndMs !== null && windowEndMs <= windowStartMs

  const timelineItems: PlanTimelineItem[] = [
    ...schedules.flatMap((schedule) => {
      const span = scheduleSpan(schedule)
      return span ? [{ key: `schedule-${schedule.id}`, kind: 'schedule' as const, title: schedule.title, ...span }] : []
    }),
    ...draftSpans.flatMap(({ draft, startMs, endMs }) =>
      startMs === null || endMs === null
        ? []
        : [{
            key: String(draft.taskId),
            kind: 'block' as const,
            title: draft.title,
            startMs,
            endMs,
            selected: draft.selected,
            hasIssue:
              draft.selected &&
              ((clientIssues[draft.taskId]?.length ?? 0) > 0 || (serverIssues[draft.taskId]?.length ?? 0) > 0),
          }],
    ),
    ...routineSpans.map((routine) => ({
      key: routine.key,
      kind: 'routine' as const,
      title: routine.name,
      startMs: routine.startMs,
      endMs: routine.endMs,
    })),
  ]

  const formatTime = (ms: number) => dayjs(ms).tz(planZoneId).format('HH:mm')
  // 시간창 끝이 다음 날이면(수면 기준 하루 전체, 자정을 넘는 취침) 00:00 대신 24:00 또는 "다음 날"로 적는다.
  const formatWindowEnd = (ms: number) => {
    const end = dayjs(ms).tz(planZoneId)
    if (!plan || end.format('YYYY-MM-DD') <= plan.date) return end.format('HH:mm')
    return end.format('HH:mm') === '00:00' ? '24:00' : `다음 날 ${end.format('HH:mm')}`
  }
  const formatDuration = (value: string) => formatIsoDurationLabel(value) ?? value

  return (
    <section className="plan-page">
      <header className="plan-page__header">
        <p className="plan-page__eyebrow">하루 계획</p>
        <h1 className="plan-page__title">자동으로 하루 시간표 제안받기</h1>
        <p className="plan-page__description">
          마감·중요도·난이도·선후관계로 배치한 제안이에요. 고른 블록만 승인하면 일정이 되고, 그 전에는 아무것도 저장되지
          않아요.
        </p>
      </header>

      <div className="plan-page__controls">
        <label className="plan-page__control">
          <span>계획일</span>
          <input type="date" value={date} min={today} onChange={(event) => handleDateChange(event.target.value)} />
        </label>
        <label className="plan-page__control">
          <span>마감 범위</span>
          <select value={horizonDays} onChange={(event) => setHorizonDays(Number(event.target.value))}>
            {HORIZON_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days === 0 ? '계획일 마감까지' : `${days}일 안 마감`}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="plan-page__refresh"
          onClick={() => setRefreshKey((key) => key + 1)}
          disabled={isLoading || isApplying}
        >
          다시 제안받기
        </button>
      </div>

      <div className="plan-page__content">
        {routineCount === 0 && !dismissed.routinesCard && (
          <div className="plan-page__nudge" role="note">
            <p>
              <span aria-hidden>🍚🌙 </span>식사·수면 시간을 알려 주시면 그 시간은 비워 두고 계획해요.
            </p>
            <div className="plan-page__nudge-actions">
              <Link to="/app/settings/routines">생활 시간 설정하기</Link>
              <button
                type="button"
                aria-label="생활 시간 안내 닫기"
                onClick={() => dismiss('routinesCard', NUDGE_KEYS.planRoutinesCardDismissed)}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {created && (
          <div className="plan-page__banner plan-page__banner--success" role="status">
            <p>
              <strong>{created.schedules.length}개 일정을 만들었어요.</strong>
            </p>
            <ul>
              {created.schedules.map((schedule) => {
                const span = scheduleSpan(schedule)
                return (
                  <li key={schedule.id}>
                    {schedule.title}
                    {span && ` · ${formatTime(span.startMs)}–${formatTime(span.endMs)}`}
                  </li>
                )
              })}
            </ul>
            <Link to={`/app/schedules?date=${created.date}`}>일정 탭에서 보기</Link>
          </div>
        )}

        {isLoading && !plan ? (
          <div className="plan-page__placeholder">
            <p>계획을 만드는 중...</p>
          </div>
        ) : error ? (
          <div className="plan-page__placeholder" role="alert">
            <p>계획을 불러오지 못했어요.</p>
            <p>{error}</p>
          </div>
        ) : plan ? (
          <>
            <section className="plan-page__section">
              <h2>하루 목표</h2>
              <p className="plan-page__objective">
                목표 {formatDuration(plan.objective.dailyObjectiveWork)} · 기존 일정{' '}
                {formatDuration(plan.objective.existingTaskWork)} + 제안 {formatDuration(plan.objective.plannedWork)} ={' '}
                <strong>{formatDuration(plan.objective.used)}</strong>
              </p>
              {windowStartMs !== null && windowEndMs !== null && (
                <p className="plan-page__hint">
                  {isWindowEmpty
                    ? plan.windowSource === 'SLEEP_ROUTINE'
                      ? '이 날은 남은 배치 가능 시간이 없어요.'
                      : '이 날은 남은 배치 가능 시간이 없어요. (기상~취침 시간이 지났어요)'
                    : `배치 가능 시간 ${formatTime(windowStartMs)}–${formatWindowEnd(windowEndMs)}`}
                  {plan.windowSource === 'SLEEP_ROUTINE' && ' · 수면 시간 기준'}
                </p>
              )}
              {plan.windowSource === 'PROFILE' && !dismissed.windowHint && (
                <p className="plan-page__hint plan-page__hint--nudge">
                  기본값 07:00–23:00 · <Link to="/app/settings/routines">수면 시간 설정하기</Link>
                  <button
                    type="button"
                    className="plan-page__dismiss"
                    aria-label="시간창 안내 닫기"
                    onClick={() => dismiss('windowHint', NUDGE_KEYS.planWindowHintDismissed)}
                  >
                    ✕
                  </button>
                </p>
              )}
            </section>

            {(timelineItems.length > 0 || !isWindowEmpty) && windowStartMs !== null && windowEndMs !== null && (
              <section className="plan-page__section">
                <h2>타임라인</h2>
                <PlanTimeline
                  zoneId={planZoneId}
                  items={timelineItems}
                  windowStartMs={windowStartMs}
                  windowEndMs={windowEndMs}
                  onSelectBlock={scrollToBlock}
                />
              </section>
            )}

            <section className="plan-page__section">
              <div className="plan-page__section-head">
                <h2>제안 블록 ({drafts.length})</h2>
                {drafts.length > 0 && (
                  <div className="plan-page__bulk">
                    <button type="button" onClick={() => setAllSelected(true)}>
                      전체 선택
                    </button>
                    <button type="button" onClick={() => setAllSelected(false)}>
                      전체 해제
                    </button>
                  </div>
                )}
              </div>
              {drafts.length === 0 ? (
                <p className="plan-page__placeholder">
                  제안할 블록이 없어요. 아직 일정이 없는 미완료 작업 중 마감이 범위 안에 있는 작업만 후보가 돼요.
                </p>
              ) : (
                <ul className="plan-page__blocks">
                  {draftSpans.map(({ draft, startMs, endMs }) => {
                    const issues = draft.selected
                      ? [...(clientIssues[draft.taskId] ?? []), ...(serverIssues[draft.taskId] ?? [])]
                      : serverIssues[draft.taskId] ?? []
                    const warnings = draft.selected ? routineWarnings[draft.taskId] ?? [] : []
                    const mealHint =
                      !dismissed.mealHint && startMs !== null && endMs !== null && planDayStartMs !== null
                        ? mealHintFor((startMs - planDayStartMs) / 60000, (endMs - planDayStartMs) / 60000, registeredKinds)
                        : null
                    const isEdited =
                      draft.startLocal !== draft.suggestedStartLocal || draft.scheduleType !== draft.suggestedType
                    return (
                      <li
                        key={draft.taskId}
                        id={`plan-block-${draft.taskId}`}
                        className={[
                          'plan-page__block',
                          draft.selected ? 'is-selected' : '',
                          issues.length > 0 ? 'has-issue' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <label className="plan-page__block-head">
                          <input
                            type="checkbox"
                            aria-label={`${draft.title} 승인에 포함`}
                            checked={draft.selected}
                            onChange={(event) => updateDraft(draft.taskId, { selected: event.target.checked })}
                          />
                          <span className="plan-page__block-title">{draft.title}</span>
                          {draft.mustTier && (
                            <span className="plan-page__badge plan-page__badge--must" title="마감이 지났거나 계획일이 마감이에요">
                              필수
                            </span>
                          )}
                        </label>
                        <p className="plan-page__block-meta">
                          {startMs !== null && endMs !== null
                            ? `${formatTime(startMs)}–${formatTime(endMs)}`
                            : '시작 시각 미정'}{' '}
                          · {formatMinutesLabel(draft.durationMinutes)}
                          {isEdited && ' · 수정함'}
                        </p>
                        <div className="plan-page__block-fields">
                          <label>
                            <span>시작</span>
                            <input
                              type="datetime-local"
                              aria-label={`${draft.title} 시작 시각`}
                              value={draft.startLocal}
                              onChange={(event) => updateDraft(draft.taskId, { startLocal: event.target.value })}
                            />
                          </label>
                          <label>
                            <span>유형</span>
                            <select
                              aria-label={`${draft.title} 일정 유형`}
                              value={draft.scheduleType}
                              onChange={(event) =>
                                updateDraft(draft.taskId, { scheduleType: event.target.value as ScheduleTaskType })
                              }
                            >
                              {SCHEDULE_TYPES.map((type) => (
                                <option key={type} value={type}>
                                  {scheduleTypeLabel[type]}
                                  {type === draft.suggestedType ? ' (제안)' : ''}
                                </option>
                              ))}
                            </select>
                          </label>
                          {isEdited && (
                            <button
                              type="button"
                              className="plan-page__reset"
                              onClick={() =>
                                updateDraft(draft.taskId, {
                                  startLocal: draft.suggestedStartLocal,
                                  scheduleType: draft.suggestedType,
                                })
                              }
                            >
                              제안대로
                            </button>
                          )}
                        </div>
                        {warnings.length > 0 && (
                          <ul className="plan-page__issues plan-page__issues--warning">
                            {warnings.map((warning, index) => (
                              <li key={`warning-${index}`}>{warning.message}</li>
                            ))}
                          </ul>
                        )}
                        {mealHint && (
                          <p className="plan-page__meal-hint">
                            {KIND_LABEL[mealHint]}시간이에요. {KIND_LABEL[mealHint]}을 등록하면 피해서 배치해요.{' '}
                            <Link to="/app/settings/routines">등록하기</Link>
                            <button
                              type="button"
                              className="plan-page__dismiss"
                              aria-label="식사 시간 안내 그만 보기"
                              onClick={() => dismiss('mealHint', NUDGE_KEYS.planMealHintDismissed)}
                            >
                              ✕
                            </button>
                          </p>
                        )}
                        {issues.length > 0 && (
                          <ul className="plan-page__issues" role="alert">
                            {issues.map((issue, index) => (
                              <li key={`${issue.reason ?? 'client'}-${index}`}>
                                {issue.message}
                                {issue.detail && <small>{issue.detail}</small>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section className="plan-page__section">
              <h2>배치하지 못한 작업 ({plan.unplaced.length})</h2>
              {plan.unplaced.length === 0 ? (
                <p className="plan-page__hint">배치하지 못한 작업이 없어요.</p>
              ) : (
                <ul className="plan-page__unplaced">
                  {plan.unplaced.map((task) => (
                    <li key={task.taskId}>
                      <div>
                        <Link to={`/app/tasks/${task.taskId}`} className="plan-page__unplaced-title">
                          {task.title}
                        </Link>
                        {task.mustTier && (
                          <span className="plan-page__badge plan-page__badge--must" title="마감이 지났거나 계획일이 마감이에요">
                            필수
                          </span>
                        )}
                      </div>
                      <p>{unplacedReasonLabel(task.reason)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>

      {plan && drafts.length > 0 && (
        <footer className="plan-page__footer">
          {applyError && (
            <p className="plan-page__apply-error" role="alert">
              {applyError}
            </p>
          )}
          {tooMany && <p className="plan-page__apply-error">한 번에 {MAX_APPLY_BLOCKS}개까지 승인할 수 있어요.</p>}
          {hasClientIssues && (
            <p className="plan-page__apply-error">표시된 블록의 시각을 고치거나 선택을 빼면 승인할 수 있어요.</p>
          )}
          <div className="plan-page__footer-row">
            <span>
              {selectedCount}개 선택 · {formatMinutesLabel(selectedMinutes)}
            </span>
            <button type="button" className="plan-page__apply" onClick={handleApply} disabled={!canApply}>
              {isApplying ? '승인하는 중...' : '선택한 블록으로 일정 만들기'}
            </button>
          </div>
        </footer>
      )}
    </section>
  )
}

export default PlanPage
