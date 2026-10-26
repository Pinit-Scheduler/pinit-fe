// 강조 사각형과 말풍선 위치 계산. node:test가 그대로 불러오므로 import 없이 쓴다.

export type Rect = { top: number; left: number; width: number; height: number }
export type Viewport = { width: number; height: number }

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/** 대상 사각형을 padding만큼 넓힌 뒤 화면([0, viewport]) 안으로 자른다. */
export const spotlightRect = (target: Rect, viewport: Viewport, padding = 8): Rect => {
  const top = clamp(target.top - padding, 0, viewport.height)
  const left = clamp(target.left - padding, 0, viewport.width)
  const bottom = clamp(target.top + target.height + padding, 0, viewport.height)
  const right = clamp(target.left + target.width + padding, 0, viewport.width)
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

export type CalloutPlacement = { placement: 'below' | 'above' | 'center'; top: number }

/**
 * 말풍선은 강조 영역 아래, 안 되면 위, 둘 다 안 되거나 강조 영역이 없으면 화면 가운데에 둔다.
 * 가운데 배치는 말풍선이 화면보다 커도 위쪽이 잘리지 않게 0 아래로 내리지 않는다.
 */
export const calloutPlacement = (
  spot: Rect | null,
  viewport: Viewport,
  calloutHeight: number,
  gap = 12,
): CalloutPlacement => {
  if (spot) {
    const spotBottom = spot.top + spot.height
    if (viewport.height - spotBottom >= calloutHeight + gap) {
      return { placement: 'below', top: spotBottom + gap }
    }
    if (spot.top >= calloutHeight + gap) {
      return { placement: 'above', top: spot.top - gap - calloutHeight }
    }
  }
  return { placement: 'center', top: Math.max(0, (viewport.height - calloutHeight) / 2) }
}
