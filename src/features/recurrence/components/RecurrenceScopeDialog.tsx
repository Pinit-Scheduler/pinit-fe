import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import Modal from '@shared/components/common/Modal'
import { usePresence } from '@shared/motion'
import {
  scopeOptions,
  scopeQuestion,
  type OccurrenceScope,
  type ScopeAction,
} from '../utils/recurrenceRules'
import './RecurrenceScopeDialog.css'

export type { OccurrenceScope } from '../utils/recurrenceRules'
type AskOptions = {
  preview?: (scope: OccurrenceScope) => Promise<string>
  scopes?: OccurrenceScope[]
}
type Pending = {
  id: number
  action: ScopeAction
  title: string
  options: AskOptions
  resolve: (scope: OccurrenceScope | null) => void
}

/** Scope and the server dry-run impact are confirmed together; only the caller commits. */
export const useRecurrenceScope = (): {
  dialog: ReactNode
  ask: (
    action: ScopeAction,
    title: string,
    options?: AskOptions,
  ) => Promise<OccurrenceScope | null>
} => {
  const titleId = useId()
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  const [selected, setSelected] = useState<OccurrenceScope>('THIS')
  const [previewState, setPreviewState] = useState<{
    key: string
    impact: string
    error: string | null
  }>({ key: '', impact: '', error: null })
  const requestId = useRef(0)
  const [attempt, setAttempt] = useState(0)
  const ask = useCallback(
    (action: ScopeAction, title: string, options: AskOptions = {}) =>
      new Promise<OccurrenceScope | null>((resolve) => {
        pendingRef.current?.resolve(null)
        const next = {
          id: ++requestId.current,
          action,
          title,
          options,
          resolve,
        }
        pendingRef.current = next
        setSelected(options.scopes?.[0] ?? 'THIS')
        setPending(next)
      }),
    [],
  )
  // 닫힐 때도 마지막 요청을 그대로 보여 주며 사라진다(usePresence + Modal closing).
  const presence = usePresence(pending)
  const shown = presence.value
  const previewKey = `${shown?.id}:${selected}:${attempt}`
  const loading = Boolean(shown && previewState.key !== previewKey)
  const impact = previewState.key === previewKey ? previewState.impact : ''
  const error = previewState.key === previewKey ? previewState.error : null
  useEffect(
    () => () => {
      pendingRef.current?.resolve(null)
    },
    [],
  )
  useEffect(() => {
    if (!pending) return
    let cancelled = false
    const preview = Promise.resolve().then(
      () =>
        pending.options.preview?.(selected) ??
        (selected === 'THIS'
          ? '선택한 이번 회차에만 반영해요.'
          : '선택한 범위의 반복 회차에 반영해요.'),
    )
    preview
      .then((message) => {
        if (!cancelled)
          setPreviewState({ key: previewKey, impact: message, error: null })
      })
      .catch((reason) => {
        if (!cancelled)
          setPreviewState({
            key: previewKey,
            impact: '',
            error:
              reason instanceof Error
                ? reason.message
                : '변경 범위를 확인하지 못했어요.',
          })
      })
    return () => {
      cancelled = true
    }
  }, [pending, selected, previewKey])
  const finish = (scope: OccurrenceScope | null) => {
    pendingRef.current?.resolve(scope)
    pendingRef.current = null
    setPending(null)
  }
  const dialog = presence.mounted && shown ? (
    <Modal
      backdropClassName="recurrence-scope__backdrop"
      className="recurrence-scope__sheet"
      onClose={() => finish(null)}
      labelledBy={titleId}
      closing={presence.closing}
    >
      <h2 id={titleId} className="recurrence-scope__title">
        반복 {shown.action === 'edit' ? '수정' : '삭제'}
      </h2>
      <p className="recurrence-scope__subtitle">
        {scopeQuestion(shown.action, shown.title)}
      </p>
      <fieldset className="recurrence-scope__options">
        <legend>적용 범위</legend>
        {scopeOptions(shown.action)
          .filter(
            (option) =>
              !shown.options.scopes ||
              shown.options.scopes.includes(option.scope),
          )
          .map((option) => (
            <label key={option.scope} className="recurrence-scope__option">
              <input
                type="radio"
                name={titleId}
                value={option.scope}
                checked={selected === option.scope}
                onChange={() => setSelected(option.scope)}
              />
              <span>
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </span>
            </label>
          ))}
      </fieldset>
      <div
        className="recurrence-scope__impact"
        aria-live="polite"
        aria-busy={loading}
      >
        {loading ? (
          '영향을 확인하는 중…'
        ) : error ? (
          <p role="alert">
            {error}{' '}
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              다시 확인
            </button>
          </p>
        ) : (
          impact
        )}
      </div>
      <div className="recurrence-scope__actions">
        <button
          type="button"
          className="recurrence-scope__cancel"
          onClick={() => finish(null)}
        >
          취소
        </button>
        <button
          type="button"
          className="recurrence-scope__confirm"
          disabled={loading || Boolean(error) || !impact}
          onClick={() => finish(selected)}
        >
          이 범위로 {shown.action === 'edit' ? '저장' : '삭제'}
        </button>
      </div>
    </Modal>
  ) : null
  return { dialog, ask }
}
