import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react'

type ModalProps = {
  /** 닫기 요청(Esc, 바깥 클릭). 없으면 Esc와 바깥 클릭으로 닫히지 않는다. */
  onClose?: () => void
  /** 제목 요소의 id. 그 요소가 없으면(로딩 중 등) ariaLabel이 이름이 된다. */
  labelledBy?: string
  ariaLabel?: string
  describedBy?: string
  /** 바깥(배경) 요소 class. 기존 화면 CSS를 그대로 쓴다. */
  backdropClassName: string
  /** 대화상자 본체 class. */
  className: string
  /** 바깥 클릭으로 닫을지. 기본 true. */
  closeOnBackdrop?: boolean
  children: ReactNode
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// 열린 모달 순서. Esc와 포커스 트랩은 맨 위 모달만 처리한다(상세 모달 위에 일정 모달이 뜨는 경우).
const stack: symbol[] = []

const focusableIn = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement)

/**
 * 공통 모달 껍데기. role="dialog"와 aria-modal을 달고, Tab 포커스를 안에 가두고,
 * Esc로 닫고, 닫히면 열기 전 포커스로 돌려준다. 모양은 넘겨받은 class가 정한다.
 */
const Modal = ({
  onClose,
  labelledBy,
  ariaLabel,
  describedBy,
  backdropClassName,
  className,
  closeOnBackdrop = true,
  children,
}: ModalProps) => {
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const id = Symbol('modal')
    stack.push(id)
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    if (dialog && !dialog.contains(document.activeElement)) {
      const autofocus = dialog.querySelector<HTMLElement>('[autofocus]')
      ;(autofocus ?? focusableIn(dialog)[0] ?? dialog).focus({ preventScroll: true })
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id || !dialogRef.current) return
      if (event.key === 'Escape') {
        if (!onCloseRef.current) return
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusableIn(dialogRef.current)
      if (items.length === 0) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      // 로딩 중 조작할 요소가 없어 본체에 둔 포커스가 남아 있을 수 있다. 본체도 앞쪽 경계로 본다.
      const atStart = active === first || active === dialogRef.current || !dialogRef.current.contains(active)
      if (event.shiftKey && atStart) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const index = stack.indexOf(id)
      if (index >= 0) stack.splice(index, 1)
      if (previous && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  const handleBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && event.target === event.currentTarget) onClose?.()
  }

  return (
    <div className={backdropClassName} onClick={handleBackdrop}>
      <div
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export default Modal
