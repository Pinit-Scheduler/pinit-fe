import type { Box } from './editor'
import type { MapLayout } from './layout'

export type View = { x: number; y: number; k: number }
export type Frame = { w: number; h: number }

export const ZOOM = { MIN: 0.25, MAX: 2, STEP: 1.2, WHEEL: 0.01 } as const
/** 이 폭 이상이면 PC로 본다(왼쪽 메뉴가 붙는 경계). */
export const PC_MIN_WIDTH = 900

const TOP_BAR = 64
const BOTTOM_BAR = 96

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

export const pageScale = (viewportWidth: number): number => (viewportWidth >= PC_MIN_WIDTH ? 1 : 0.85)

/** (cx, cy) 화면 점이 같은 맵 점 위에 머물도록 확대한다. */
export const zoomAt = (view: View, cx: number, cy: number, factor: number): View => {
  const k = clamp(view.k * factor, ZOOM.MIN, ZOOM.MAX)
  const ratio = k / view.k
  return { x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio, k }
}

export const wheelFactor = (deltaY: number): number => Math.exp(-deltaY * ZOOM.WHEEL)

/** 확대·축소 단추: 캔버스 가운데를 기준으로 `ZOOM.STEP`씩. */
export const zoomStep = (view: View, frame: Frame, dir: 1 | -1): View =>
  zoomAt(view, frame.w / 2, frame.h / 2, dir > 0 ? ZOOM.STEP : 1 / ZOOM.STEP)

/** 두 손가락을 대기 시작한 때의 배율과 두 점 사이 거리. */
export type Pinch = { k: number; distance: number }

/** 두 손가락: 시작 배율에 거리 비율을 곱한 배율로, 두 점의 가운데(cx, cy)를 고정한다. */
export const pinchView = (view: View, pinch: Pinch, distance: number, cx: number, cy: number): View => {
  const k = clamp((pinch.k * distance) / pinch.distance, ZOOM.MIN, ZOOM.MAX)
  return zoomAt(view, cx, cy, k / view.k)
}

/** 화면상의 상자(캔버스 기준). */
export type ScreenRect = { left: number; top: number; bottom: number; width: number }

/** 같은 단계 사이에 끼울 자리의 3px 선: 앞이면 그 가지 위, 뒤면 아래. 폭은 56px 이상. */
export const insertLine = (target: ScreenRect, mode: 'before' | 'after'): { left: number; top: number; width: number } => ({
  left: target.left,
  top: mode === 'before' ? target.top - 5 : target.bottom + 2,
  width: Math.max(target.width, 56),
})

/** 가로는 가운데, 세로는 위·아래 막대를 뺀 칸의 가운데. */
export const centerOn = (box: Box, frame: Frame, k: number): View => ({
  x: frame.w / 2 - (box.x + box.w / 2) * k,
  y: TOP_BAR + (frame.h - TOP_BAR - BOTTOM_BAR) / 2 - (box.y + box.h / 2) * k,
  k,
})

export const fitView = (bounds: MapLayout['bounds'], frame: Frame): View => {
  const k = clamp(Math.min((frame.w - 48) / bounds.w, (frame.h - 160) / bounds.h, 1), ZOOM.MIN, 1)
  return {
    x: (frame.w - bounds.w * k) / 2 - bounds.x0 * k,
    y: TOP_BAR + (frame.h - TOP_BAR - BOTTOM_BAR - bounds.h * k) / 2 - bounds.y0 * k,
    k,
  }
}

/** 가지가 왼 20·오른 28·위 60·아래 100 안쪽에 들어오도록 옮긴다. 넘치면 왼쪽·위를 맞춘다. */
export const keepVisible = (view: View, box: Box, frame: Frame): View => {
  let { x, y } = view
  const { k } = view
  const left = x + box.x * k
  const right = left + box.w * k
  const top = y + box.y * k
  const bottom = top + box.h * k
  if (right > frame.w - 28) x -= right - (frame.w - 28)
  if (left + (x - view.x) < 20) x += 20 - (left + (x - view.x))
  if (bottom > frame.h - 100) y -= bottom - (frame.h - 100)
  if (top + (y - view.y) < 60) y += 60 - (top + (y - view.y))
  return { x, y, k }
}
