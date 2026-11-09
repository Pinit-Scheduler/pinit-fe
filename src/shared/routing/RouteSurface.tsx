import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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
  type Location,
  type NavigateFunction,
  type NavigateOptions,
} from 'react-router-dom'
import { createPortal } from 'react-dom'
import Modal from '@shared/components/common/Modal'
import {
  locationHref,
  safeBackground,
  surfaceCloseAction,
  surfaceFallback,
  type SurfaceState,
} from './routeSurfaceState'
import './RouteSurface.css'

type SurfaceContextValue = {
  allowExit: () => void
  markDirty: () => void
  footerTarget: HTMLDivElement | null
  /** The page behind the surface came from this session, so closing can go back to it. */
  hasBackground: boolean
  /** The href of the page this surface replaced in history (a replace navigation), if any. */
  replacedPage: string | null
}
const SurfaceContext = createContext<SurfaceContextValue | null>(null)

const closeSurface = (
  navigate: NavigateFunction,
  location: Location,
  hasBackground: boolean,
  replacedPage: string | null,
  fallback?: string,
) => {
  const historyIndex =
    (window.history.state as { idx?: number } | null)?.idx ?? 0
  // Go back to the page that opened the surface when this session has it, including surfaces
  // opened with a plain link that carried no background state.
  const action = surfaceCloseAction({
    hasState: !!safeBackground(location.state),
    hasBackground,
    replacedPage,
    historyIndex,
    fallback: fallback ?? surfaceFallback(location.pathname),
  })
  if (action.back) navigate(-1)
  else navigate(action.to, { replace: true })
}

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
  const hasBackground = surface?.hasBackground ?? false
  const replacedPage = surface?.replacedPage ?? null
  const close = useCallback(
    (fallback?: string) =>
      closeSurface(navigate, location, hasBackground, replacedPage, fallback),
    [hasBackground, replacedPage, location, navigate],
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

/**
 * One surface (modal on desktop, sheet on mobile) for every surface route. It stays mounted while
 * the user moves between surface paths (detail to edit, task 5 to task 6); only the page inside
 * changes, with a short crossfade. `closing` plays the exit after the route has already left;
 * App keeps the surface mounted for that time.
 */
export const RouteSurface = ({
  title,
  input = false,
  closing = false,
  pathname,
  hasBackground = false,
  replacedPage = null,
  children,
}: {
  title: string
  input?: boolean
  closing?: boolean
  /** The surface path shown. A new path starts a clean form session. */
  pathname: string
  hasBackground?: boolean
  /** The href of the page this surface replaced in history, if it did. */
  replacedPage?: string | null
  children: ReactNode
}) => {
  const navigate = useNavigate()
  const location = useLocation()
  const close = () => {
    if (!closing) closeSurface(navigate, location, hasBackground, replacedPage)
  }
  const [dirty, setDirty] = useState(false)
  const [footerTarget, setFooterTarget] = useState<HTMLDivElement | null>(null)
  const allowExitRef = useRef(false)
  // A different surface path is a new form session: drop the previous page's unsaved flag.
  const [session, setSession] = useState({ pathname, swapped: false })
  if (session.pathname !== pathname) {
    setSession({ pathname, swapped: true })
    setDirty(false)
  }
  useEffect(() => {
    allowExitRef.current = false
  }, [pathname])
  const guard = input && dirty && !closing
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      guard &&
      !allowExitRef.current &&
      locationHref(currentLocation) !== locationHref(nextLocation),
  )
  useBeforeUnload(
    useCallback(
      (event) => {
        if (!guard || allowExitRef.current) return
        event.preventDefault()
        event.returnValue = ''
      },
      [guard],
    ),
  )
  // A layout effect, so the shell and bottom tab come back in the frame the surface starts closing.
  useLayoutEffect(() => {
    if (closing) return
    const shell = document.querySelector<HTMLElement>('.app-shell')
    const alreadyInert = shell?.hasAttribute('inert')
    shell?.setAttribute('inert', '')
    if (input) document.body.dataset.routeSurfaceInput = 'true'
    return () => {
      if (!alreadyInert) shell?.removeAttribute('inert')
      if (input) delete document.body.dataset.routeSurfaceInput
    }
  }, [closing, input])
  const value = useMemo<SurfaceContextValue>(
    () => ({
      allowExit: () => {
        allowExitRef.current = true
      },
      markDirty: () => setDirty(true),
      footerTarget,
      hasBackground,
      replacedPage,
    }),
    [footerTarget, hasBackground, replacedPage],
  )
  return (
    <SurfaceContext.Provider value={value}>
      <Modal
        onClose={close}
        ariaLabel={title}
        backdropClassName="route-surface-backdrop"
        className="route-surface"
        closing={closing}
        sheet
      >
        <header className="route-surface__header">
          <h1>{title}</h1>
          <button
            type="button"
            className="route-surface__close"
            onClick={close}
            aria-label="닫기"
          >
            <WorkspaceIcon name="close" />
          </button>
        </header>
        <div
          className="route-surface__body"
          data-input-mode={input || undefined}
          onChangeCapture={() => {
            if (input) setDirty(true)
          }}
        >
          <div
            key={pathname}
            className="route-surface__page"
            data-swapped={session.swapped || undefined}
          >
            {children}
          </div>
        </div>
        <div className="route-surface__footer" ref={setFooterTarget} />
      </Modal>
      {blocker.state === 'blocked' && !closing && (
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
