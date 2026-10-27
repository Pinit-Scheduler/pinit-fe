import { useCallback, useRef, useState, type ReactNode } from 'react'
import { scopeOptions, scopeQuestion, type OccurrenceScope, type ScopeAction } from '../utils/recurrenceRules'
import './RecurrenceScopeDialog.css'

export type { OccurrenceScope } from '../utils/recurrenceRules'

type Pending = {
  action: ScopeAction
  title: string
  resolve: (scope: OccurrenceScope | null) => void
}

/**
 * 반복 회차를 고치거나 지울 범위를 묻는 바텀시트(ADR-0019 §14).
 * {@code ask}는 고른 범위를, 닫으면 null을 돌려준다. {@code dialog}를 화면에 함께 그려야 한다.
 */
export const useRecurrenceScope = (): { dialog: ReactNode; ask: (action: ScopeAction, title: string) => Promise<OccurrenceScope | null> } => {
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)

  const ask = useCallback(
    (action: ScopeAction, title: string) =>
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
        <p className="recurrence-scope__subtitle">{scopeQuestion(pending.action, pending.title)}</p>
        <div className="recurrence-scope__options">
          {scopeOptions(pending.action).map((option) => (
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
