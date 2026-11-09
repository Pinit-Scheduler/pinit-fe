import type { Location } from 'react-router-dom'

export type SurfaceState = { backgroundLocation?: Location; returnTo?: string }

export const isSurfacePath = (pathname: string) =>
  /^\/app\/(?:tasks\/(?:new|\d+(?:\/edit)?)|schedules\/(?:new|\d+(?:\/edit)?)|new)\/?$/.test(
    pathname,
  )

export const surfaceFallback = (pathname: string) =>
  pathname.startsWith('/app/tasks') ? '/app/tasks' : '/app/schedules'

export const isInputSurface = (pathname: string) =>
  pathname.endsWith('/new') || pathname.endsWith('/edit')

export const locationHref = (
  location: Pick<Location, 'pathname' | 'search' | 'hash'>,
) => `${location.pathname}${location.search}${location.hash}`

export const safeBackground = (state: unknown): Location | undefined => {
  const candidate = (state as SurfaceState | null)?.backgroundLocation
  return candidate?.pathname?.startsWith('/app/') &&
    !isSurfacePath(candidate.pathname)
    ? candidate
    : undefined
}

export type SurfaceCloseAction = { back: true } | { back: false; to: string }

/**
 * How closing a surface returns to the page behind it.
 * - Opened with background state, or pushed over a page this session showed: step back.
 * - Reached by a replace from a page (the onboarding tour does this): that page's history entry
 *   is gone, so stepping back would leave it. Go to the page itself, replacing the surface.
 * - Otherwise (a deep link, the first history entry): the fallback list, replacing the surface.
 */
export const surfaceCloseAction = ({
  hasState,
  hasBackground,
  replacedPage,
  historyIndex,
  fallback,
}: {
  hasState: boolean
  hasBackground: boolean
  /** The href of the page this surface replaced in history, if it did. */
  replacedPage: string | null
  historyIndex: number
  fallback: string
}): SurfaceCloseAction => {
  if (hasState && historyIndex > 0) return { back: true }
  if (replacedPage) return { back: false, to: replacedPage }
  if (hasBackground && historyIndex > 0) return { back: true }
  return { back: false, to: fallback }
}

/** The heading of the surface shown for a surface path. */
export const surfaceTitle = (pathname: string) => {
  const path = pathname.replace(/\/$/, '')
  const task = path.startsWith('/app/tasks/')
  if (path.endsWith('/new')) return task ? '작업 추가' : '일정 추가'
  if (path.endsWith('/edit')) return task ? '작업 수정' : '일정 수정'
  return task ? '작업 상세' : '일정 상세'
}
