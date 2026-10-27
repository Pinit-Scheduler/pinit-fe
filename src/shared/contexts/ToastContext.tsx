/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './Toast.css'

/** 토스트 안의 버튼 하나(예: 삭제 직후 "되돌리기"). 누르면 토스트가 닫히고 onAction이 돈다. */
export type ToastAction = {
  label: string
  onAction: () => void
}

export type ToastOptions = {
  action?: ToastAction
  /** 기본 3초. 버튼이 있는 토스트는 누를 시간을 더 준다. */
  durationMs?: number
}

type Toast = {
  id: number
  message: string
  type?: 'error' | 'info' | 'success'
  action?: ToastAction
}

type ToastContextValue = {
  addToast: (message: string, type?: Toast['type'], options?: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const addToast = useCallback(
    (message: string, type: Toast['type'] = 'info', options?: ToastOptions) => {
      nextId.current += 1
      const id = nextId.current
      setToasts((prev) => [...prev, { id, message, type, action: options?.action }])
      setTimeout(() => dismiss(id), options?.durationMs ?? 3000)
    },
    [dismiss],
  )

  const value = useMemo(() => ({ addToast }), [addToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={['toast', toast.type && `toast--${toast.type}`].filter(Boolean).join(' ')}>
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
