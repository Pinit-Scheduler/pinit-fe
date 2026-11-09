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

/** The heading of the surface shown for a surface path. */
export const surfaceTitle = (pathname: string) => {
  const path = pathname.replace(/\/$/, '')
  const task = path.startsWith('/app/tasks/')
  if (path.endsWith('/new')) return task ? '작업 추가' : '일정 추가'
  if (path.endsWith('/edit')) return task ? '작업 수정' : '일정 수정'
  return task ? '작업 상세' : '일정 상세'
}
