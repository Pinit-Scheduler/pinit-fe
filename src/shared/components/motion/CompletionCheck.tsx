import type { ChangeEvent } from 'react'
import './CompletionCheck.css'

type CompletionCheckProps = {
  /** The state to show. For an optimistic toggle pass the optimistic value, not the server's. */
  checked: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  /** Accessible name, e.g. `${title} 완료` / `${title} 완료 취소`. */
  label: string
  /**
   * Only for "not allowed" (no permission). Do not disable while a save is pending:
   * guard re-entry in the handler so the check never dims mid-animation.
   */
  disabled?: boolean
  /** 'round' for tasks (default), 'square' for schedules or lists that use square boxes. */
  shape?: 'round' | 'square'
  className?: string
}

/**
 * The completion check. Checking fills the box with the accent and draws the tick like a pen
 * stroke; unchecking erases it quickly. A native checkbox sits on top, so keyboard, focus and
 * forms work as usual. Pair it with .motion-strike on the title for the strike line.
 */
export default function CompletionCheck({
  checked,
  onChange,
  label,
  disabled = false,
  shape = 'round',
  className,
}: CompletionCheckProps) {
  return (
    <span
      className={['completion-check', className].filter(Boolean).join(' ')}
      data-checked={checked || undefined}
      data-shape={shape}
      data-disabled={disabled || undefined}
    >
      <input
        className="completion-check__input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={label}
      />
      <svg
        className="completion-check__glyph"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        {shape === 'round' ? (
          <circle className="completion-check__box" cx="12" cy="12" r="11.25" />
        ) : (
          <rect
            className="completion-check__box"
            x="0.75"
            y="0.75"
            width="22.5"
            height="22.5"
            rx="6"
          />
        )}
        <path
          className="completion-check__mark"
          d="M7.25 12.35 10.6 15.7 16.9 8.9"
          pathLength={1}
        />
      </svg>
    </span>
  )
}
