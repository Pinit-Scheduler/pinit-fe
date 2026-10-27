import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '@shared/api/httpClient'
import { useToast } from '@contexts/ToastContext'
import { formatMinutesLabel } from '@shared/utils/isoDuration'
import { NUDGE_KEYS, writeFlag } from '@shared/utils/safeStorage'
import { fetchRoutines, saveRoutines } from '../api/routines'
import type { DayOfWeek, Routine, RoutineKind } from '../types/routine'
import {
  DAYS_OF_WEEK,
  DAY_LABEL,
  KIND_LABEL,
  KIND_PRESET,
  MAX_LABEL_LENGTH,
  MAX_ROUTINES,
  PRESET_KINDS,
  hasRoutineIssues,
  mapRoutineServerErrors,
  sortDays,
  splitDaysForNewEntry,
  toRoutineDraft,
  toRoutineInput,
  validateRoutineDrafts,
} from '../utils/routineRules'
import type { RoutineDraft, RoutineIssue } from '../utils/routineRules'
import './RoutinesPage.css'

const KIND_ICON: Record<RoutineKind, string> = {
  BREAKFAST: '🍳',
  LUNCH: '🍚',
  DINNER: '🍲',
  SLEEP: '🌙',
  CUSTOM: '✏️',
}

const HOUR_OPTIONS = Array.from({ length: 17 }, (_, hours) => hours)
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) => index * 5)

let keySeq = 0
const nextKey = () => `routine-${(keySeq += 1)}`

/** 화면·전송 순서: 아침, 점심, 저녁, 수면, 직접 추가. 400의 routines[i]는 이 순서를 가리킨다 */
const ordered = (drafts: RoutineDraft[]) => [
  ...PRESET_KINDS.flatMap((kind) => drafts.filter((draft) => draft.kind === kind)),
  ...drafts.filter((draft) => draft.kind === 'CUSTOM'),
]

const fromServer = (routines: Routine[]) => ordered(routines.map((routine) => toRoutineDraft(routine, nextKey())))

const snapshotOf = (drafts: RoutineDraft[]) => JSON.stringify(drafts.map(toRoutineInput))

const newDraft = (kind: RoutineKind, overrides: Partial<RoutineDraft> = {}): RoutineDraft => ({
  key: nextKey(),
  kind,
  label: '',
  startTime: KIND_PRESET[kind].startTime,
  durationMinutes: KIND_PRESET[kind].durationMinutes,
  days: [...DAYS_OF_WEEK],
  ...overrides,
})

const summaryOf = (draft: RoutineDraft) => {
  const days = sortDays(draft.days)
  const dayText =
    days.length === 7
      ? '매일'
      : days.join() === 'MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY'
        ? '평일'
        : days.join() === 'SATURDAY,SUNDAY'
          ? '주말'
          : days.map((day) => DAY_LABEL[day]).join('·') || '요일 없음'
  const length = draft.durationMinutes ? formatMinutesLabel(draft.durationMinutes) : '?'
  return `${dayText} ${draft.startTime} · ${length}`
}

const RoutinesPage = () => {
  const { addToast } = useToast()
  const [drafts, setDrafts] = useState<RoutineDraft[]>([])
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshotOf([]))
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [serverIssues, setServerIssues] = useState<Record<string, RoutineIssue[]>>({})
  const [generalErrors, setGeneralErrors] = useState<string[]>([])
  const [conflict, setConflict] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    writeFlag(NUDGE_KEYS.routinesNewBadgeSeen)
  }, [])

  const load = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const response = await fetchRoutines()
      const next = fromServer(response?.routines ?? [])
      setDrafts(next)
      setSavedSnapshot(snapshotOf(next))
      setServerIssues({})
      setGeneralErrors([])
      setConflict(false)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '생활 시간을 불러오지 못했어요.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const validation = useMemo(() => validateRoutineDrafts(drafts), [drafts])
  const clientIssuesByKey = useMemo(() => {
    const result: Record<string, RoutineIssue[]> = {}
    Object.entries(validation.byIndex).forEach(([index, issues]) => {
      const draft = drafts[Number(index)]
      if (draft) result[draft.key] = issues
    })
    return result
  }, [drafts, validation])

  const isDirty = snapshotOf(drafts) !== savedSnapshot
  const canSave = isDirty && !isSaving && !hasRoutineIssues(validation)

  const update = (next: RoutineDraft[], touchedKeys: string[] = []) => {
    setDrafts(ordered(next))
    setJustSaved(false)
    if (touchedKeys.length > 0) {
      setServerIssues((prev) => {
        const copy = { ...prev }
        touchedKeys.forEach((key) => delete copy[key])
        return copy
      })
    }
  }

  const patchDraft = (key: string, patch: Partial<RoutineDraft>) =>
    update(drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)), [key])

  const removeDraft = (key: string) => update(drafts.filter((draft) => draft.key !== key), [key])

  const toggleKind = (kind: RoutineKind, enabled: boolean) => {
    if (enabled) {
      update([...drafts, newDraft(kind)])
    } else {
      update(
        drafts.filter((draft) => draft.kind !== kind),
        drafts.filter((draft) => draft.kind === kind).map((draft) => draft.key),
      )
    }
  }

  const addVariant = (kind: RoutineKind) => {
    const sameKind = drafts.filter((draft) => draft.kind === kind)
    const last = sameKind[sameKind.length - 1]
    const { lastDays, newDays } = splitDaysForNewEntry(sameKind.map((draft) => draft.days))
    const next = drafts.map((draft) => (lastDays && draft.key === last?.key ? { ...draft, days: lastDays } : draft))
    update([
      ...next,
      newDraft(kind, {
        startTime: last?.startTime ?? KIND_PRESET[kind].startTime,
        durationMinutes: last?.durationMinutes ?? KIND_PRESET[kind].durationMinutes,
        days: newDays,
      }),
    ])
  }

  const toggleDay = (draft: RoutineDraft, day: DayOfWeek) => {
    const days = draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day]
    patchDraft(draft.key, { days: sortDays(days) })
  }

  const handleSave = async () => {
    if (!canSave) return
    const sent = ordered(drafts)
    setIsSaving(true)
    setServerIssues({})
    setGeneralErrors([])
    setConflict(false)
    try {
      const response = await saveRoutines({ routines: sent.map(toRoutineInput) })
      const next = fromServer(response?.routines ?? [])
      setDrafts(next)
      setSavedSnapshot(snapshotOf(next))
      setJustSaved(true)
      addToast(next.length > 0 ? '생활 시간을 저장했어요. 다음 계획부터 비워 두고 배치해요.' : '생활 시간을 모두 지웠어요.', 'success')
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        const mapped = mapRoutineServerErrors(error.data)
        const byKey: Record<string, RoutineIssue[]> = {}
        Object.entries(mapped.byIndex).forEach(([index, issues]) => {
          const draft = sent[Number(index)]
          if (draft) byKey[draft.key] = issues
          else mapped.general.push(...issues.map((issue) => issue.message))
        })
        setServerIssues(byKey)
        setGeneralErrors(mapped.general)
        addToast('저장하지 못했어요. 표시된 항목을 확인해 주세요.', 'error')
      } else if (error instanceof ApiError && error.status === 409) {
        setConflict(true)
        addToast('다른 곳에서 생활 시간이 바뀌었어요.', 'error')
      } else {
        const message = error instanceof Error ? error.message : '저장하지 못했어요.'
        setGeneralErrors([message])
        addToast('생활 시간을 저장하지 못했어요.', 'error')
      }
    } finally {
      setIsSaving(false)
    }
  }

  const renderEntry = (draft: RoutineDraft, removable: boolean) => {
    const issues = [...(clientIssuesByKey[draft.key] ?? []), ...(serverIssues[draft.key] ?? [])]
    const fieldIssue = (field: RoutineIssue['field']) => issues.some((issue) => issue.field === field)
    const minutes = draft.durationMinutes ?? 0
    const hours = Math.floor(minutes / 60)
    const restMinutes = minutes % 60
    const minuteOptions = MINUTE_OPTIONS.includes(restMinutes) ? MINUTE_OPTIONS : [...MINUTE_OPTIONS, restMinutes].sort((a, b) => a - b)
    const name = draft.kind === 'CUSTOM' ? draft.label.trim() || '이름 없음' : KIND_LABEL[draft.kind]
    return (
      <li key={draft.key} className={['routines__entry', issues.length > 0 ? 'has-issue' : ''].filter(Boolean).join(' ')}>
        {draft.kind === 'CUSTOM' && (
          <label className="routines__field">
            <span>이름</span>
            <input
              value={draft.label}
              maxLength={MAX_LABEL_LENGTH}
              placeholder="예: 운동, 출퇴근"
              aria-invalid={fieldIssue('label')}
              onChange={(event) => patchDraft(draft.key, { label: event.target.value })}
            />
          </label>
        )}
        <div className="routines__row">
          <label className="routines__field">
            <span>시작</span>
            <input
              type="time"
              value={draft.startTime}
              aria-label={`${name} 시작 시각`}
              aria-invalid={fieldIssue('startTime')}
              onChange={(event) => patchDraft(draft.key, { startTime: event.target.value })}
            />
          </label>
          <div className="routines__field">
            <span>길이</span>
            <div className="routines__duration">
              <select
                value={hours}
                aria-label={`${name} 길이(시간)`}
                aria-invalid={fieldIssue('duration')}
                onChange={(event) => patchDraft(draft.key, { durationMinutes: Number(event.target.value) * 60 + restMinutes })}
              >
                {HOUR_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}시간
                  </option>
                ))}
              </select>
              <select
                value={restMinutes}
                aria-label={`${name} 길이(분)`}
                aria-invalid={fieldIssue('duration')}
                onChange={(event) => patchDraft(draft.key, { durationMinutes: hours * 60 + Number(event.target.value) })}
              >
                {minuteOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}분
                  </option>
                ))}
              </select>
            </div>
          </div>
          {removable && (
            <button type="button" className="routines__remove" onClick={() => removeDraft(draft.key)} aria-label={`${name} 항목 삭제`}>
              ✕
            </button>
          )}
        </div>
        <div className="routines__days" role="group" aria-label={`${name} 반복 요일`}>
          {DAYS_OF_WEEK.map((day) => (
            <button
              key={day}
              type="button"
              className={['routines__day', draft.days.includes(day) ? 'is-active' : ''].filter(Boolean).join(' ')}
              aria-pressed={draft.days.includes(day)}
              onClick={() => toggleDay(draft, day)}
            >
              {DAY_LABEL[day]}
            </button>
          ))}
        </div>
        <p className="routines__summary">{summaryOf(draft)}</p>
        {issues.length > 0 && (
          <ul className="routines__issues" role="alert">
            {issues.map((issue, index) => (
              <li key={`${issue.field ?? 'entry'}-${index}`}>{issue.message}</li>
            ))}
          </ul>
        )}
      </li>
    )
  }

  const customDrafts = drafts.filter((draft) => draft.kind === 'CUSTOM')
  const atLimit = drafts.length >= MAX_ROUTINES

  return (
    <section className="routines">
      <header className="routines__header">
        <p className="routines__eyebrow">설정</p>
        <h1 className="routines__title">생활 시간</h1>
        <p className="routines__description">
          식사·수면 시간을 알려 주시면 자동 계획이 그 시간은 비워 두고 배치해요. 모두 선택 사항이고, 요일마다 다르게 정할 수
          있어요.
        </p>
        <p className="routines__description">
          운동처럼 완료를 체크할 일은 생활 시간이 아니라 <Link to="/app/settings/recurrences">반복 일정·작업</Link>으로 등록해
          주세요.
        </p>
      </header>

      {isLoading ? (
        <div className="routines__placeholder">생활 시간을 불러오는 중...</div>
      ) : loadError ? (
        <div className="routines__placeholder" role="alert">
          <p>생활 시간을 불러오지 못했어요.</p>
          <p>{loadError}</p>
          <button type="button" className="routines__link-button" onClick={load}>
            다시 시도
          </button>
        </div>
      ) : (
        <>
          {PRESET_KINDS.map((kind) => {
            const entries = drafts.filter((draft) => draft.kind === kind)
            const enabled = entries.length > 0
            return (
              <section key={kind} className="routines__card" aria-label={`${KIND_LABEL[kind]} 시간`}>
                <div className="routines__card-head">
                  <div>
                    <p className="routines__card-title">
                      <span aria-hidden>{KIND_ICON[kind]}</span> {KIND_LABEL[kind]}
                    </p>
                    <p className="routines__card-sub">
                      {enabled
                        ? entries.map(summaryOf).join(' / ')
                        : `꺼짐 · 켜면 ${KIND_PRESET[kind].startTime}부터 ${formatMinutesLabel(KIND_PRESET[kind].durationMinutes)}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={['routines__toggle', enabled ? 'is-active' : ''].filter(Boolean).join(' ')}
                    aria-pressed={enabled}
                    aria-label={`${KIND_LABEL[kind]} ${enabled ? '끄기' : '켜기'}`}
                    disabled={!enabled && atLimit}
                    onClick={() => toggleKind(kind, !enabled)}
                  >
                    <span />
                  </button>
                </div>
                {enabled && (
                  <>
                    <ul className="routines__entries">{entries.map((draft) => renderEntry(draft, entries.length > 1))}</ul>
                    <button type="button" className="routines__link-button" onClick={() => addVariant(kind)} disabled={atLimit}>
                      ＋ 요일별로 다르게
                    </button>
                  </>
                )}
              </section>
            )
          })}

          <section className="routines__card" aria-label="직접 추가한 생활 시간">
            <div className="routines__card-head">
              <div>
                <p className="routines__card-title">
                  <span aria-hidden>{KIND_ICON.CUSTOM}</span> 직접 추가
                </p>
                <p className="routines__card-sub">운동·출퇴근처럼 이름을 붙여 비워 둘 시간을 더할 수 있어요.</p>
              </div>
            </div>
            {customDrafts.length > 0 && <ul className="routines__entries">{customDrafts.map((draft) => renderEntry(draft, true))}</ul>}
            <button type="button" className="routines__link-button" onClick={() => update([...drafts, newDraft('CUSTOM')])} disabled={atLimit}>
              ＋ 직접 추가
            </button>
          </section>

          {atLimit && <p className="routines__note">생활 시간은 {MAX_ROUTINES}개까지 등록할 수 있어요.</p>}

          <footer className="routines__footer">
            {conflict && (
              <p className="routines__error" role="alert">
                다른 곳에서 생활 시간이 먼저 바뀌었어요.{' '}
                <button type="button" className="routines__link-button" onClick={load}>
                  최신 상태 불러오기
                </button>{' '}
                (지금 고친 내용은 사라져요)
              </p>
            )}
            {[...validation.general, ...generalErrors].map((message) => (
              <p key={message} className="routines__error" role="alert">
                {message}
              </p>
            ))}
            {justSaved && !isDirty && (
              <p className="routines__saved">
                저장했어요. <Link to="/app/plan">계획 화면에서 확인하기</Link>
              </p>
            )}
            <div className="routines__footer-row">
              <span>{isDirty ? '저장하지 않은 변경이 있어요' : `${drafts.length}개 등록됨`}</span>
              <button type="button" className="routines__save" onClick={handleSave} disabled={!canSave}>
                {isSaving ? '저장하는 중...' : '저장'}
              </button>
            </div>
          </footer>
        </>
      )}
    </section>
  )
}

export default RoutinesPage
