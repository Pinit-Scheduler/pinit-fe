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
