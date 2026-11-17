import { useState } from 'react'
import TermHelp from '@shared/components/common/TermHelp'
import { FIBONACCI_DIFFICULTIES } from '@constants/difficulty'
import type {
  SplitCheck,
  SplitCheckPiece,
  SplitFieldError,
  SplitPiece,
} from '../api/splitProposals'
import { orderChoiceNote, PREVIOUS_HELP } from '../utils/splitProposalLabels'
import CycleHelp from './CycleHelp'

type PieceFormProps = {
  piece: SplitPiece
  info: SplitCheckPiece
  limits: SplitCheck['limits']
  errors: SplitFieldError[]
  busy: boolean
  onCancel: () => void
  onSubmit: (next: SplitPiece) => void
}

const FIELDS: readonly string[] = ['title', 'minutes', 'difficulty', 'dueDate', 'after', 'description']

/**
 * 조각 내용 창의 고치기 단계. 한도와 고를 수 있는 이전 조각은 서버가 준 값이고, 화면은 스스로 막지 않는다
 * (`noValidate`). "확인"은 고친 조각을 통째로 넘기고, 서버가 준 칸별 오류는 그 칸 아래에 보인다.
 */
export default function PieceForm({
  piece,
  info,
  limits,
  errors,
  busy,
  onCancel,
  onSubmit,
}: PieceFormProps) {
  const [form, setForm] = useState<SplitPiece>(piece)
  const set = (next: Partial<SplitPiece>) => setForm((prev) => ({ ...prev, ...next }))
  const errorsOf = (match: (field: string) => boolean) =>
    errors
      .filter((error) => match(error.field))
      .map((error, index) => (
        <small key={`${error.field}-${index}`} className="split-form__error" role="alert">
          {error.message}
        </small>
      ))
  const errorOf = (field: SplitFieldError['field']) => errorsOf((name) => name === field)
  return (
    <form
      className="split-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(form)
      }}
    >
      {errorsOf((name) => !FIELDS.includes(name))}
      <label>
        제목
        <input
          value={form.title}
          maxLength={limits.titleMax}
          onChange={(event) => set({ title: event.target.value })}
        />
        {errorOf('title')}
      </label>
      <div className="split-form__row">
        <label>
          예상 시간(분)
          <input
            type="number"
            step={5}
            min={limits.minutesMin}
            max={limits.minutesMax}
            inputMode="numeric"
            value={form.minutes || ''}
            onChange={(event) => set({ minutes: Number(event.target.value) })}
          />
          {errorOf('minutes')}
        </label>
        <label>
          난이도
          <select
            value={form.difficulty}
            onChange={(event) => set({ difficulty: Number(event.target.value) })}
          >
            {FIBONACCI_DIFFICULTIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          {errorOf('difficulty')}
        </label>
        <label>
          마감
          <input
            type="date"
            value={form.dueDate ?? ''}
            min={limits.dueMin ?? undefined}
            max={limits.dueMax ?? undefined}
            onChange={(event) => set({ dueDate: event.target.value || null })}
          />
          {errorOf('dueDate')}
        </label>
      </div>
      {info.orderChoices.length > 0 && (
        <fieldset>
          <legend>
            이전 조각
            <TermHelp label={PREVIOUS_HELP.label}>
              <strong>{PREVIOUS_HELP.title}</strong>
              {PREVIOUS_HELP.body}
            </TermHelp>
          </legend>
          {info.orderChoices.map((choice) => {
            // 뺀 조각을 거쳐 이어진 조각은 읽기 단계의 "이전 조각"과 맞게 체크된 채 꺼 둔다.
            const via = choice.link === 'VIA_EXCLUDED'
            const note = orderChoiceNote(choice)
            return (
              <label key={choice.key} className="split-form__check">
                <input
                  type="checkbox"
                  checked={via || form.after.includes(choice.key)}
                  disabled={choice.blocked || via}
                  onChange={(event) =>
                    // 이 키만 넣고 뺀다. 뺀 조각을 가리키는 원래 간선은 그대로 둔다.
                    set({
                      after: event.target.checked
                        ? [...form.after, choice.key]
                        : form.after.filter((key) => key !== choice.key),
                    })
                  }
                />
                {choice.title || '제목 없음'}
                {note && (
                  <small>
                    {' '}
                    {note}
                    {choice.blocked && (
                      <>
                        {' '}
                        <CycleHelp />
                      </>
                    )}
                  </small>
                )}
              </label>
            )
          })}
          {errorOf('after')}
        </fieldset>
      )}
      <label>
        설명
        <textarea
          rows={9}
          maxLength={limits.descriptionMax}
          value={form.description}
          onChange={(event) => set({ description: event.target.value })}
        />
        <small>
          {form.description.length} / {limits.descriptionMax.toLocaleString()}
        </small>
        {errorOf('description')}
      </label>
      <div className="split-dialog__actions">
        <button type="button" className="workspace-button" disabled={busy} onClick={onCancel}>
          취소
        </button>
        <button
          type="submit"
          className="workspace-button workspace-button--primary"
          disabled={busy}
        >
          {busy ? '확인하는 중…' : '확인'}
        </button>
      </div>
    </form>
  )
}
