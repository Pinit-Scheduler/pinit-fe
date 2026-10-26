import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '@contexts/ToastContext'
import { ApiError } from '@shared/api/httpClient'
import { deleteRecurrence, fetchRecurrences, updateRecurrence } from '../api/recurrences'
import RecurrenceRuleFields from '../components/RecurrenceRuleFields'
import type { RecurrenceSeries, RecurrenceStatus } from '../types/recurrence'
import {
  deleteImpactMessage,
  describeRule,
  editImpactMessage,
  mapRecurrenceServerErrors,
  toRule,
  toRuleDraft,
  validateRuleDraft,
  type RuleDraft,
} from '../utils/recurrenceRules'
import { formatIsoDurationLabel } from '@shared/utils/isoDuration'
import { NUDGE_KEYS, writeFlag } from '@shared/utils/safeStorage'
import './RecurrencesPage.css'

const MODE_LABEL = { FIXED: '반복 일정', FLEXIBLE: '반복 작업' } as const

/**
 * 설정 → 반복 관리(ADR-0019 §14). 진행 중·끝난 반복 목록과 규칙 요약을 보고, 제목·규칙을 전체에 바꾸거나 반복을 끝낸다.
 * 회차 하나나 "이번 및 이후"는 일정·작업 화면에서 회차를 골라 바꾼다.
 */
const RecurrencesPage = () => {
  const { addToast } = useToast()
  const [status, setStatus] = useState<RecurrenceStatus>('ACTIVE')
  const [items, setItems] = useState<RecurrenceSeries[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: number; draft: RuleDraft; errors: Record<string, string> } | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetchRecurrences(status)
      setItems(response.recurrences)
    } catch (loadError) {
      console.error('반복 목록 조회 실패', loadError)
      setError('반복 목록을 불러오지 못했어요.')
    }
  }, [status])

  useEffect(() => {
    setItems(null)
    void load()
  }, [load])

  useEffect(() => {
    writeFlag(NUDGE_KEYS.recurrencesNewBadgeSeen)
  }, [])

  const run = async (series: RecurrenceSeries, work: (id: number) => Promise<boolean>, done: string) => {
    if (series.id === null) return
    setBusyId(series.id)
    try {
      if (await work(series.id)) {
        addToast(done, 'success')
        setEditing(null)
        await load()
      }
    } catch (runError) {
      if (runError instanceof ApiError && runError.status === 400 && editing) {
        setEditing({ ...editing, errors: mapRecurrenceServerErrors(runError.data) })
      }
      console.error('반복 변경 실패', runError)
      addToast(runError instanceof ApiError && runError.status === 409 ? '반복이 이미 바뀌었어요. 다시 불러올게요.' : '반복을 바꾸지 못했어요.', 'error')
      if (runError instanceof ApiError && runError.status === 409) await load()
    } finally {
      setBusyId(null)
    }
  }

  const rename = (series: RecurrenceSeries) => {
    const title = window.prompt('새 제목(1~20자)', series.title)?.trim()
    if (!title || title === series.title) return
    void run(series, async (id) => {
      const payload = { scope: 'ALL' as const, changes: { title } }
      const preview = await updateRecurrence(id, payload, true)
      const message = editImpactMessage(preview.impact) ?? '앞으로 만들 회차부터 새 제목을 써요.'
      if (!window.confirm(`${message}\n계속할까요?`)) return false
      await updateRecurrence(id, payload, false)
      return true
    }, '제목을 바꿨어요.')
  }

  const saveRule = (series: RecurrenceSeries) => {
    if (!editing) return
    const errors = validateRuleDraft(editing.draft)
    if (Object.keys(errors).length) {
      setEditing({ ...editing, errors: errors as Record<string, string> })
      return
    }
    void run(series, async (id) => {
      const payload = { scope: 'ALL' as const, changes: { rule: toRule(editing.draft) } }
      const preview = await updateRecurrence(id, payload, true)
      const message = editImpactMessage(preview.impact) ?? '바뀌는 회차가 없어요.'
      if (!window.confirm(`${message}\n계속할까요?`)) return false
      await updateRecurrence(id, payload, false)
      return true
    }, '반복 규칙을 바꿨어요.')
  }

  const end = (series: RecurrenceSeries) =>
    run(series, async (id) => {
      const preview = await deleteRecurrence(id, 'ALL', undefined, true)
      if (!window.confirm(`"${series.title}" 반복을 끝낼까요?\n${deleteImpactMessage(preview.impact)}`)) return false
      await deleteRecurrence(id, 'ALL', undefined, false)
      return true
    }, '반복을 끝냈어요.')

  return (
    <section className="recurrences">
      <header className="recurrences__header">
        <p className="recurrences__eyebrow">설정</p>
        <h1 className="recurrences__title">반복 관리</h1>
        <p className="recurrences__description">
          일정이나 작업을 만들 때 "반복"을 켜면 여기에 모여요. 회차는 오늘부터 28일 치를 미리 만들고 매시간 이어서 만들어요.
          회차 하나만 바꾸려면 일정·작업 화면에서 그 회차를 고치세요.
        </p>
      </header>

      <div className="recurrences__tabs" role="tablist" aria-label="반복 상태">
        {(['ACTIVE', 'ENDED'] as RecurrenceStatus[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={status === value}
            className={`recurrences__tab${status === value ? ' is-active' : ''}`}
            onClick={() => setStatus(value)}
          >
            {value === 'ACTIVE' ? '진행 중' : '끝남'}
          </button>
        ))}
      </div>

      {error && (
        <div className="recurrences__placeholder" role="alert">
          {error}{' '}
          <button type="button" className="recurrences__link" onClick={load}>
            다시 시도
          </button>
        </div>
      )}
      {!error && items === null && <div className="recurrences__placeholder">반복 목록을 불러오는 중...</div>}
      {!error && items?.length === 0 && (
        <div className="recurrences__placeholder">
          {status === 'ACTIVE' ? (
            <>
              아직 반복이 없어요. <Link to="/app/schedules/new">일정 추가</Link>나 <Link to="/app/tasks/new">작업 추가</Link>에서
              "반복"을 켜 보세요.
            </>
          ) : (
            '끝난 반복이 없어요.'
          )}
        </div>
      )}

      <ul className="recurrences__list">
        {items?.map((series) => (
          <li key={series.id ?? series.title} className="recurrences__item">
            <div className="recurrences__item-head">
              <p className="recurrences__item-title">
                🔁 {series.title}
                <span className="recurrences__mode">{MODE_LABEL[series.mode]}</span>
                {series.ended && status === 'ACTIVE' && <span className="recurrences__mode">남은 회차 없음</span>}
              </p>
              <p className="recurrences__item-rule">
                {describeRule(series.rule)}
                {series.fixed && ` · ${series.fixed.startTime} · ${formatIsoDurationLabel(series.fixed.plannedDuration) ?? ''}`}
                {series.flexible && ' · 회차 날짜 안에 하는 작업'}
              </p>
              <p className="recurrences__item-meta">
                {series.rule.startDate} 시작 · {series.zoneId} · {series.generatedUntil}까지 만듦
              </p>
            </div>
            {status === 'ACTIVE' && series.id !== null && (
              <div className="recurrences__actions">
                <button type="button" onClick={() => rename(series)} disabled={busyId === series.id}>
                  제목 바꾸기
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(editing?.id === series.id ? null : { id: series.id as number, draft: toRuleDraft(series.rule), errors: {} })}
                  disabled={busyId === series.id}
                >
                  규칙 바꾸기
                </button>
                <button type="button" className="is-danger" onClick={() => end(series)} disabled={busyId === series.id}>
                  끝내기
                </button>
              </div>
            )}
            {editing?.id === series.id && (
              <div className="recurrences__editor">
                <RecurrenceRuleFields
                  draft={editing.draft}
                  onChange={(draft) => setEditing({ ...editing, draft })}
                  errors={Object.fromEntries(Object.entries(editing.errors).map(([key, value]) => [key.replace(/^rule\./, ''), value]))}
                />
                <p className="recurrences__note">
                  규칙을 바꾸면 오늘 이후의 시작 전 회차를 지우고 새 규칙으로 다시 만들어요. 시작했거나 지난 회차는 그대로예요.
                </p>
                <div className="recurrences__actions">
                  <button type="button" onClick={() => setEditing(null)}>
                    취소
                  </button>
                  <button type="button" className="is-primary" onClick={() => saveRule(series)} disabled={busyId === series.id}>
                    규칙 저장
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default RecurrencesPage
