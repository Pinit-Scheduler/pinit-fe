import type { MouseEvent } from 'react'

/** A plain left click. Modified clicks and other buttons keep the browser's own handling (new tab, new window). */
export const isPlainLeftClick = (event: MouseEvent) =>
  !event.defaultPrevented &&
  event.button === 0 &&
  !event.metaKey &&
  !event.altKey &&
  !event.ctrlKey &&
  !event.shiftKey

/**
 * onClick for a link to a route surface. A plain left click goes through `open()`, so the page
 * behind stays and closing returns to it; other clicks follow the link.
 */
export const surfaceLinkClick =
  (open: (path: string) => void, path: string) =>
  (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(event)) return
    event.preventDefault()
    open(path)
  }
