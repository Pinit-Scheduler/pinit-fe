import { useRef } from 'react'
import { useToast } from '@contexts/ToastContext'
import './CopyableCode.css'

type CopyableCodeProps = {
  label: string
  value: string
  multiline?: boolean
  /** multiline일 때 줄바꿈되는 긴 한 줄 명령을 위해 높이를 직접 지정한다. */
  rows?: number
  copyLabel?: string
}

const CopyableCode = ({ label, value, multiline = false, rows, copyLabel = '복사' }: CopyableCodeProps) => {
  const { addToast } = useToast()
  const fieldRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null)

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(value)
      addToast(`${label}을(를) 복사했어요.`, 'success')
    } catch {
      // 클립보드 권한이 없으면 직접 복사할 수 있도록 텍스트를 선택해 둔다.
      fieldRef.current?.select()
      addToast('자동 복사에 실패했어요. 선택된 내용을 직접 복사해주세요.', 'error')
    }
  }

  return (
    <div className="copyable-code">
      {multiline ? (
        <textarea
          ref={fieldRef}
          className="copyable-code__field copyable-code__field--multiline"
          value={value}
          readOnly
          rows={rows ?? value.split('\n').length}
          aria-label={label}
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : (
        <input
          ref={fieldRef}
          className="copyable-code__field"
          value={value}
          readOnly
          aria-label={label}
          spellCheck={false}
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      <button type="button" className="copyable-code__btn" onClick={handleCopy}>
        {copyLabel}
      </button>
    </div>
  )
}

export default CopyableCode
