import { useToast } from '@contexts/ToastContext'
import type { InputRow } from './conflicts'

export default function MyInputDisclosure({
  rows,
  open,
}: {
  rows: InputRow[]
  open: boolean
}) {
  const { addToast } = useToast()
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      addToast('복사했어요.', 'success')
    } catch {
      addToast('복사하지 못했어요. 내용을 직접 선택해 복사하세요.', 'error')
    }
  }
  return (
    <details className="space-my-input" open={open || undefined}>
      <summary>{open ? '내 입력 보기' : '저장하지 못한 내 입력 보기'}</summary>
      {rows.length === 0 ? (
        <p className="space-my-input__empty">바꾼 내용이 없어요.</p>
      ) : (
        <>
          <ul className="space-my-input__list">
            {rows.map((row) => (
              <li key={row.label}>
                <div>
                  <strong>{row.label}</strong>
                  <span>{row.value || '(비어 있음)'}</span>
                </div>
                <button
                  type="button"
                  className="workspace-button"
                  onClick={() => void copy(row.value)}
                >
                  복사
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="workspace-button"
            onClick={() =>
              void copy(rows.map((row) => `${row.label}: ${row.value}`).join('\n'))
            }
          >
            모두 복사
          </button>
        </>
      )}
    </details>
  )
}
