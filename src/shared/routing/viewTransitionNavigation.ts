import type { MouseEvent } from 'react'
import { isPlainLeftClick } from './linkClick'

/**
 * Tab changes with a view transition.
 *
 * Every app page renders inside descendant <Routes>, where react-router's Link/NavLink use the
 * plain navigator and silently drop the `viewTransition` option. App registers the data
 * router's own navigate here, and tab links call it on a plain left click.
 */
type TransitionNavigate = (to: string) => void
let transitionNavigate: TransitionNavigate | null = null

export const registerTransitionNavigate = (navigate: TransitionNavigate) => {
  transitionNavigate = navigate
}

/** onClick for a tab link. Modified clicks, other buttons and the current page keep the default. */
export const tabLinkClick = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => {
  if (!transitionNavigate || !isPlainLeftClick(event) || window.location.pathname === to) return
  event.preventDefault()
  transitionNavigate(to)
}
