import { useCallback, useRef, useState, type ReactNode } from 'react'
import type { RecurrenceScope } from '../types/recurrence'
import './RecurrenceScopeDialog.css'

/** "이번만"은 기존 일정·작업 API로, 나머지는 반복 API로 간다. */
export type OccurrenceScope = 'THIS' | RecurrenceScope

type Pending = {
  action: 'edit' | 'delete'
  title: string
  resolve: (scope: OccurrenceScope | null) => void
}

const OPTIONS: { scope: OccurrenceScope; label: string; description: string }[] = [
  { scope: 'THIS', label: '이번만', description: '이 회차 하나만 바꿔요.' },
  { scope: 'FOLLOWING', label: '이번 및 이후', description: '이 회차부터 뒤의 회차를 모두 바꿔요.' },
  { scope: 'ALL', label: '전체', description: '반복 전체를 바꿔요. 시작했거나 지난 회차는 그대로 둬요.' },
]

/**
 * 반복 회차를 고치거나 지울 범위를 묻는 바텀시트(ADR-0019 §14).
 * {@code ask}는 고른 범위를, 닫으면 null을 돌려준다. {@code dialog}를 화면에 함께 그려야 한다.
 */
export const useRecurrenceScope = (): { dialog: ReactNode; ask: (action: 'edit' | 'delete', title: string) => Promise<OccurrenceScope | null> } => {
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)

  const ask = useCallback(
    (action: 'edit' | 'delete', title: string) =>
      new Promise<OccurrenceScope | null>((resolve) => {
        const next = { action, title, resolve }
        pendingRef.current = next
        setPending(next)
      }),
    [],
  )

  const finish = (scope: OccurrenceScope | null) => {
    pendingRef.current?.resolve(scope)
    pendingRef.current = null
    setPending(null)
  }

  const dialog = pending ? (
    <div className="recurrence-scope__backdrop" onClick={() => finish(null)}>
      <div
        className="recurrence-scope__sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recurrence-scope-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="recurrence-scope-title" className="recurrence-scope__title">
          🔁 반복 {pending.action === 'edit' ? '수정' : '삭제'}
        </h2>
        <p className="recurrence-scope__subtitle">"{pending.title}"은 반복 회차예요. 어디까지 {pending.action === 'edit' ? '바꿀까요' : '지울까요'}?</p>
        <div className="recurrence-scope__options">
          {OPTIONS.map((option) => (
            <button key={option.scope} type="button" className="recurrence-scope__option" onClick={() => finish(option.scope)}>
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
        <button type="button" className="recurrence-scope__cancel" onClick={() => finish(null)}>
          취소
        </button>
      </div>
    </div>
  ) : null

  return { dialog, ask }
}
