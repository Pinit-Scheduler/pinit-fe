import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  useBeforeUnload,
  useBlocker,
  useLocation,
  useNavigate,
  type NavigateOptions,
} from 'react-router-dom'
import { createPortal } from 'react-dom'
import Modal from '@shared/components/common/Modal'
import {
  locationHref,
  safeBackground,
  surfaceFallback,
  type SurfaceState,
} from './routeSurfaceState'
import './RouteSurface.css'

type SurfaceContextValue = {
  allowExit: () => void
  markDirty: () => void
  footerTarget: HTMLDivElement | null
}
const SurfaceContext = createContext<SurfaceContextValue | null>(null)

// The route component and its navigation API intentionally share one public module.
// eslint-disable-next-line react-refresh/only-export-components
export const useRouteSurfaceNavigation = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const surface = useContext(SurfaceContext)
  const open = useCallback(
    (path: string, options: NavigateOptions = {}) => {
      const background = safeBackground(location.state) ?? location
      navigate(path, {
        ...options,
        state: {
          ...options.state,
          backgroundLocation: background,
          returnTo: locationHref(background),
        },
      })
    },
    [location, navigate],
  )
  const close = useCallback(
    (fallback?: string) => {
      const background = safeBackground(location.state)
      const historyIndex =
        (window.history.state as { idx?: number } | null)?.idx ?? 0
      if (background && historyIndex > 0) navigate(-1)
      else
        navigate(fallback ?? surfaceFallback(location.pathname), {
          replace: true,
        })
    },
    [location, navigate],
  )
  const complete = useCallback(
    (fallback?: string) => {
      surface?.allowExit()
      close(fallback)
    },
    [close, surface],
  )
  const markDirty = useCallback(() => surface?.markDirty(), [surface])
  return { open, close, complete, markDirty }
}

export type { SurfaceState }

/** Actions retain native form association via each submit button's form attribute. */
export const RouteSurfaceActions = ({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) => {
  const surface = useContext(SurfaceContext)
  const actions = <div className={className}>{children}</div>
  return surface?.footerTarget
    ? createPortal(actions, surface.footerTarget)
    : actions
}

export const RouteSurface = ({
  title,
  input = false,
  children,
}: {
  title: string
  input?: boolean
  children: ReactNode
}) => {
  const { close } = useRouteSurfaceNavigation()
  const [dirty, setDirty] = useState(false)
  const [footerTarget, setFooterTarget] = useState<HTMLDivElement | null>(null)
  const allowExitRef = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      input &&
      dirty &&
      !allowExitRef.current &&
      locationHref(currentLocation) !== locationHref(nextLocation),
  )
  useBeforeUnload(
    useCallback(
      (event) => {
        if (!input || !dirty || allowExitRef.current) return
        event.preventDefault()
        event.returnValue = ''
      },
      [dirty, input],
    ),
  )
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.app-shell')
    const alreadyInert = shell?.hasAttribute('inert')
    shell?.setAttribute('inert', '')
    if (input) document.body.dataset.routeSurfaceInput = 'true'
    return () => {
      if (!alreadyInert) shell?.removeAttribute('inert')
      if (input) delete document.body.dataset.routeSurfaceInput
    }
  }, [input])
  const value = useMemo<SurfaceContextValue>(
    () => ({
      allowExit: () => {
        allowExitRef.current = true
      },
      markDirty: () => setDirty(true),
      footerTarget,
    }),
    [footerTarget],
  )
  return (
    <SurfaceContext.Provider value={value}>
      <Modal
        onClose={() => close()}
        ariaLabel={title}
        backdropClassName="route-surface-backdrop"
        className="route-surface"
      >
        <header className="route-surface__header">
          <h1>{title}</h1>
          <button
            type="button"
            className="route-surface__close"
            onClick={() => close()}
            aria-label="닫기"
          >
            ×
          </button>
        </header>
        <div
          className="route-surface__body"
          data-input-mode={input || undefined}
          onChangeCapture={() => {
            if (input) setDirty(true)
          }}
        >
          {children}
        </div>
        <div className="route-surface__footer" ref={setFooterTarget} />
      </Modal>
      {blocker.state === 'blocked' && (
        <Modal
          onClose={() => blocker.reset()}
          ariaLabel="저장하지 않은 변경"
          backdropClassName="route-exit-backdrop"
          className="route-exit-dialog"
        >
          <h2>변경 내용을 저장하지 않았어요</h2>
          <p>나가면 작성 중인 내용이 사라져요.</p>
          <div className="route-exit-dialog__actions">
            <button type="button" onClick={() => blocker.reset()}>
              계속 작성
            </button>
            <button type="button" onClick={() => blocker.proceed()}>
              저장하지 않고 나가기
            </button>
          </div>
        </Modal>
      )}
    </SurfaceContext.Provider>
  )
}
