import { useCallback, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { ApiError } from '@shared/api/httpClient'
import { useToast } from '@contexts/ToastContext'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { getTodayWithOffset } from '@shared/utils/datetime'
import { formatMinutesLabel, parseIsoDurationMinutes } from '@shared/utils/isoDuration'
import { deleteRoutineOverride, fetchRoutineOverrides, saveRoutineOverride } from '../api/routines'
import type { RoutineKind, RoutineOverride } from '../types/routine'
import {
  DAY_LABEL,
  KIND_LABEL,
  KIND_PRESET,
  MAX_LABEL_LENGTH,
  MAX_OVERRIDE_NOTE_LENGTH,
  MAX_ROUTINES,
  OVERRIDE_FUTURE_DAYS,
  addDays,
  dayOfWeekOf,
  hasRoutineIssues,
  isEditableOverrideDate,
  mapRoutineServerErrors,
  overrideItemsFromWeekly,
  routineName,
  toOverrideItemDraft,
  toOverrideItemInput,
  validateOverrideItems,
} from '../utils/routineRules'
import type { OverrideItemDraft, RoutineDraft, RoutineIssue } from '../utils/routineRules'

const KINDS: RoutineKind[] = ['BREAKFAST', 'LUNCH', 'DINNER', 'SLEEP', 'CUSTOM']
const HOUR_OPTIONS = Array.from({ length: 17 }, (_, hours) => hours)
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) => index * 5)

let keySeq = 0
const nextKey = () => `override-${(keySeq += 1)}`

type Editor = {
  /** 기존 예외를 고치는 중이면 그 날짜(바꿀 수 없다). 새로 만들면 null */
  originalDate: string | null
  date: string
  note: string
  items: OverrideItemDraft[]
}

type Props = {
  /** 저장된 주간 생활 시간. 새 예외를 만들 때 그 요일 항목을 복사한다 */
  weekly: RoutineDraft[]
  /** 알림을 켜려 할 때 브라우저 알림 권한을 확인한다 */
  onReminderEnabled: () => void
}

const dateLabel = (date: string) => {
  const day = dayOfWeekOf(date)
  return `${dayjs(date).format('M월 D일')}${day ? ` (${DAY_LABEL[day]})` : ''}`
}

const itemSummary = (item: RoutineOverride['routines'][number]) => {
  const minutes = parseIsoDurationMinutes(item.duration)
  return `${routineName(item)} ${item.startTime.slice(0, 5)}${minutes ? ` · ${formatMinutesLabel(minutes)}` : ''}${
    item.remindAtStart ? ' 🔔' : ''
  }`
}

/**
 * ADR-0027 날짜 예외: 휴일·여행처럼 하루만 다른 날에 그날 시작하는 생활 시간을 바꾸거나 건너뛴다.
 * 공휴일은 자동으로 가져오지 않는다. 사용자가 날짜를 골라 직접 등록한다.
 */
const RoutineOverridesSection = ({ weekly, onReminderEnabled }: Props) => {
  const { addToast } = useToast()
  // 계획 화면과 같은 기준의 오늘(앱 시간대 설정)
  const { offsetMinutes } = useTimePreferences()
  const today = useMemo(() => getTodayWithOffset(offsetMinutes).format('YYYY-MM-DD'), [offsetMinutes])
  const [overrides, setOverrides] = useState<RoutineOverride[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [serverIssues, setServerIssues] = useState<Record<string, RoutineIssue[]>>({})
  const [generalErrors, setGeneralErrors] = useState<string[]>([])

  const load = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const response = await fetchRoutineOverrides({ from: addDays(today, -1), to: addDays(today, OVERRIDE_FUTURE_DAYS) })
      setOverrides(response?.overrides ?? [])
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '날짜 예외를 불러오지 못했어요.')
    } finally {
      setIsLoading(false)
    }
  }, [today])

  useEffect(() => {
    load()
  }, [load])

  const validation = useMemo(
    () => (editor ? validateOverrideItems(editor.items, editor.note) : { byIndex: {}, general: [] }),
    [editor],
  )
  const dateValid = editor ? isEditableOverrideDate(editor.date, today) : false
  const dateTaken =
    editor !== null && editor.date !== editor.originalDate && overrides.some((override) => override.date === editor.date)
  const canSave = editor !== null && dateValid && !dateTaken && !isSaving && !hasRoutineIssues(validation)

  const openNew = () => {
    const date = addDays(today, 1)
    setEditor({ originalDate: null, date, note: '', items: overrideItemsFromWeekly(date, weekly, nextKey) })
    setServerIssues({})
    setGeneralErrors([])
  }

  const openExisting = (override: RoutineOverride) => {
    setEditor({
      originalDate: override.date,
      date: override.date,
      note: override.note ?? '',
      items: override.routines.map((item) => toOverrideItemDraft(item, nextKey())),
    })
    setServerIssues({})
    setGeneralErrors([])
  }

  const patchEditor = (patch: Partial<Editor>) => setEditor((prev) => (prev ? { ...prev, ...patch } : prev))

  const changeDate = (date: string) => {
    if (!editor) return
    // 새로 만드는 중이고 아직 손대지 않았으면 그 날짜 요일의 주간 항목으로 다시 채운다
    const untouched =
      editor.originalDate === null &&
      JSON.stringify(editor.items.map(toOverrideItemInput)) ===
        JSON.stringify(overrideItemsFromWeekly(editor.date, weekly, nextKey).map(toOverrideItemInput))
    patchEditor({ date, items: untouched ? overrideItemsFromWeekly(date, weekly, nextKey) : editor.items })
  }

  const patchItem = (key: string, patch: Partial<OverrideItemDraft>) => {
    if (!editor) return
    if (patch.remindAtStart) onReminderEnabled()
    patchEditor({ items: editor.items.map((item) => (item.key === key ? { ...item, ...patch } : item)) })
    setServerIssues((prev) => {
      const copy = { ...prev }
      delete copy[key]
      return copy
    })
  }

  const addItem = (kind: RoutineKind) => {
    if (!editor || editor.items.length >= MAX_ROUTINES) return
    patchEditor({
      items: [
        ...editor.items,
        {
          key: nextKey(),
          kind,
          label: '',
          startTime: KIND_PRESET[kind].startTime,
          durationMinutes: KIND_PRESET[kind].durationMinutes,
          remindAtStart: false,
        },
      ],
    })
  }

  const handleSave = async () => {
    if (!editor || !canSave) return
    const sent = editor.items
    setIsSaving(true)
    setServerIssues({})
    setGeneralErrors([])
    try {
      await saveRoutineOverride(editor.date, {
        note: editor.note.trim() ? editor.note.trim() : null,
        routines: sent.map(toOverrideItemInput),
      })
      addToast(
        sent.length === 0
          ? `${dateLabel(editor.date)}은 생활 시간 없이 계획해요.`
          : `${dateLabel(editor.date)} 생활 시간을 저장했어요.`,
        'success',
      )
      setEditor(null)
      await load()
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        const mapped = mapRoutineServerErrors(error.data)
        const byKey: Record<string, RoutineIssue[]> = {}
        Object.entries(mapped.byIndex).forEach(([index, issues]) => {
          const item = sent[Number(index)]
          if (item) byKey[item.key] = issues
          else mapped.general.push(...issues.map((issue) => issue.message))
        })
        setServerIssues(byKey)
        setGeneralErrors(mapped.general)
      } else if (error instanceof ApiError && error.status === 409) {
        setGeneralErrors(['다른 곳에서 생활 시간이 먼저 바뀌었어요. 다시 저장해 주세요.'])
      } else {
        setGeneralErrors([error instanceof Error ? error.message : '저장하지 못했어요.'])
      }
      addToast('날짜 예외를 저장하지 못했어요.', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (date: string) => {
    try {
      await deleteRoutineOverride(date)
      addToast(`${dateLabel(date)}은 다시 평소 생활 시간을 따라요.`, 'success')
      if (editor?.originalDate === date) setEditor(null)
      await load()
    } catch (error) {
      addToast(error instanceof Error ? error.message : '날짜 예외를 지우지 못했어요.', 'error')
    }
  }

  const renderItem = (item: OverrideItemDraft, index: number) => {
    const issues = [...(validation.byIndex[index] ?? []), ...(serverIssues[item.key] ?? [])]
    const minutes = item.durationMinutes ?? 0
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    const minuteOptions = MINUTE_OPTIONS.includes(rest) ? MINUTE_OPTIONS : [...MINUTE_OPTIONS, rest].sort((a, b) => a - b)
    const name = item.kind === 'CUSTOM' ? item.label.trim() || '이름 없음' : KIND_LABEL[item.kind]
    return (
      <li key={item.key} className={['routines__entry', issues.length > 0 ? 'has-issue' : ''].filter(Boolean).join(' ')}>
        <div className="routines__row">
          <label className="routines__field">
            <span>종류</span>
            <select
              value={item.kind}
              aria-label={`${name} 종류`}
              onChange={(event) => patchItem(item.key, { kind: event.target.value as RoutineKind })}
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABEL[kind]}
                </option>
              ))}
            </select>
          </label>
          <label className="routines__field">
            <span>시작</span>
            <input
              type="time"
              value={item.startTime}
              aria-label={`${name} 시작 시각`}
              onChange={(event) => patchItem(item.key, { startTime: event.target.value })}
            />
          </label>
          <div className="routines__field">
            <span>길이</span>
            <div className="routines__duration">
              <select
                value={hours}
                aria-label={`${name} 길이(시간)`}
                onChange={(event) => patchItem(item.key, { durationMinutes: Number(event.target.value) * 60 + rest })}
              >
                {HOUR_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}시간
                  </option>
                ))}
              </select>
              <select
                value={rest}
                aria-label={`${name} 길이(분)`}
                onChange={(event) => patchItem(item.key, { durationMinutes: hours * 60 + Number(event.target.value) })}
              >
                {minuteOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}분
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="button"
            className="routines__remove"
            onClick={() => editor && patchEditor({ items: editor.items.filter((other) => other.key !== item.key) })}
            aria-label={`${name} 이날 빼기`}
          >
            ✕
          </button>
        </div>
        {item.kind === 'CUSTOM' && (
          <label className="routines__field">
            <span>이름</span>
            <input
              value={item.label}
              maxLength={MAX_LABEL_LENGTH}
              placeholder="예: 성묘, 이동"
              onChange={(event) => patchItem(item.key, { label: event.target.value })}
            />
          </label>
        )}
        <label className="routines__remind">
          <input
            type="checkbox"
            checked={item.remindAtStart}
            onChange={(event) => patchItem(item.key, { remindAtStart: event.target.checked })}
          />
          시작 알림
        </label>
        {issues.length > 0 && (
          <ul className="routines__issues" role="alert">
            {issues.map((issue, issueIndex) => (
              <li key={`${issue.field ?? 'entry'}-${issueIndex}`}>{issue.message}</li>
            ))}
          </ul>
        )}
      </li>
    )
  }

  // 어제 예외도 보여 준다: 어제 밤 시작한 수면이 오늘까지 이어질 수 있고, 저장할 수 있는 날짜이기도 하다
  const editable = overrides.filter((override) => override.date >= addDays(today, -1))

  return (
    <section className="routines__card" aria-label="날짜 예외">
      <div className="routines__card-head">
        <div>
          <p className="routines__card-title">
            <span aria-hidden>📅</span> 날짜 예외
          </p>
          <p className="routines__card-sub">
            휴일·여행처럼 하루만 다른 날을 등록하면 그날 계획과 알림이 예외를 따라요. 공휴일은 자동으로 넣지 않아요.
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="routines__card-sub">날짜 예외를 불러오는 중...</p>
      ) : loadError ? (
        <p className="routines__error" role="alert">
          날짜 예외를 불러오지 못했어요.{' '}
          <button type="button" className="routines__link-button" onClick={load}>
            다시 시도
          </button>
        </p>
      ) : (
        <>
          {editable.length > 0 && (
            <ul className="routines__overrides">
              {editable.map((override) => (
                <li key={override.date} className="routines__override">
                  <div>
                    <p className="routines__override-date">
                      {dateLabel(override.date)}
                      {override.note && <span className="routines__override-note"> · {override.note}</span>}
                    </p>
                    <p className="routines__card-sub">
                      {override.routines.length === 0
                        ? '생활 시간 없음'
                        : override.routines.map(itemSummary).join(' / ')}
                    </p>
                  </div>
                  <div className="routines__override-actions">
                    <button
                      type="button"
                      className="routines__link-button"
                      onClick={() => openExisting(override)}
                      disabled={isSaving}
                    >
                      고치기
                    </button>
                    <button
                      type="button"
                      className="routines__link-button"
                      onClick={() => handleDelete(override.date)}
                      disabled={isSaving}
                    >
                      지우기
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {editor ? (
            <div className="routines__override-editor">
              <div className="routines__row">
                <label className="routines__field">
                  <span>날짜</span>
                  <input
                    type="date"
                    value={editor.date}
                    min={addDays(today, -1)}
                    max={addDays(today, OVERRIDE_FUTURE_DAYS)}
                    disabled={editor.originalDate !== null}
                    aria-invalid={!dateValid || dateTaken}
                    onChange={(event) => changeDate(event.target.value)}
                  />
                </label>
                <label className="routines__field">
                  <span>메모</span>
                  <input
                    value={editor.note}
                    maxLength={MAX_OVERRIDE_NOTE_LENGTH}
                    placeholder="예: 추석, 제주 여행"
                    onChange={(event) => patchEditor({ note: event.target.value })}
                  />
                </label>
              </div>
              {!dateValid && <p className="routines__error">어제부터 {OVERRIDE_FUTURE_DAYS}일 뒤까지 고를 수 있어요.</p>}
              {dateTaken && <p className="routines__error">이 날짜에는 이미 예외가 있어요. 목록에서 고쳐 주세요.</p>}
              <p className="routines__card-sub">
                {editor.items.length === 0
                  ? '이날은 생활 시간을 모두 건너뛰어요. 전날 밤 시작한 수면은 전날 설정을 따라요.'
                  : '이날 시작하는 생활 시간을 아래 목록으로 바꿔요.'}
              </p>
              {editor.items.length > 0 && <ul className="routines__entries">{editor.items.map(renderItem)}</ul>}
              <div className="routines__override-actions">
                <select
                  className="routines__add-select"
                  value=""
                  aria-label="이날 생활 시간 더하기"
                  disabled={editor.items.length >= MAX_ROUTINES}
                  onChange={(event) => event.target.value && addItem(event.target.value as RoutineKind)}
                >
                  <option value="">＋ 더하기</option>
                  {KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABEL[kind]} ({KIND_PRESET[kind].startTime}, {formatMinutesLabel(KIND_PRESET[kind].durationMinutes)})
                    </option>
                  ))}
                </select>
                {editor.items.length > 0 && (
                  <button type="button" className="routines__link-button" onClick={() => patchEditor({ items: [] })}>
                    이날 생활 시간 없음
                  </button>
                )}
              </div>
              {[...validation.general, ...generalErrors].map((message) => (
                <p key={message} className="routines__error" role="alert">
                  {message}
                </p>
              ))}
              <div className="routines__footer-row">
                <button type="button" className="routines__link-button" onClick={() => setEditor(null)} disabled={isSaving}>
                  취소
                </button>
                <button type="button" className="routines__save" onClick={handleSave} disabled={!canSave}>
                  {isSaving ? '저장하는 중...' : '예외 저장'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="routines__link-button" onClick={openNew}>
              ＋ 날짜 추가
            </button>
          )}
        </>
      )}
    </section>
  )
}

export default RoutineOverridesSection
