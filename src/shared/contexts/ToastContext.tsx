import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import './Toast.css'
import { toastDuration } from '@shared/utils/toastPolicy'

/** 토스트 안의 버튼 하나(예: 삭제 직후 "되돌리기"). 누르면 토스트가 닫히고 onAction이 돈다. */
export type ToastAction = {
  label: string
  onAction: () => void
}

export type ToastOptions = {
  action?: ToastAction
  /** 성공 1.5초, 오류는 유지. 동작 버튼이 있으면 6초. 0이면 자동으로 닫지 않는다. */
  durationMs?: number
}

type Toast = {
  id: number
  message: string
  type?: 'error' | 'info' | 'success'
  action?: ToastAction
}

type ToastContextValue = {
  addToast: (
    message: string,
    type?: Toast['type'],
    options?: ToastOptions,
  ) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach(clearTimeout)
      pending.clear()
    }
  }, [])

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const addToast = useCallback(
    (message: string, type: Toast['type'] = 'info', options?: ToastOptions) => {
      nextId.current += 1
      const id = nextId.current
      setToasts((prev) =>
        [
          ...prev.filter((item) => item.message !== message),
          { id, message, type, action: options?.action },
        ].slice(-3),
      )
      const duration = toastDuration(type, options)
      if (duration > 0)
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        )
    },
    [dismiss],
  )

  const value = useMemo(() => ({ addToast }), [addToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={['toast', toast.type && `toast--${toast.type}`]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="toast__message">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  dismiss(toast.id)
                  toast.action?.onAction()
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              className="toast__dismiss"
              aria-label="알림 닫기"
              onClick={() => dismiss(toast.id)}
            >
              <WorkspaceIcon name="close" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('ToastContext not found')
  }
  return ctx
}
