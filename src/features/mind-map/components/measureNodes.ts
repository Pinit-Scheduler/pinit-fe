import type { Size } from '../model/layout'

/** 보이는 가지의 그린 크기(변환 전). 페이지와 홈 카드가 같은 방법으로 잰다. */
export const measure = (ids: string[], elements: ReadonlyMap<string, HTMLElement>): Map<string, Size> => {
  const sizes = new Map<string, Size>()
  for (const id of ids) {
    const el = elements.get(id)
    if (el) sizes.set(id, { w: el.offsetWidth, h: el.offsetHeight })
  }
  return sizes
}

export const sameSizes = (a: ReadonlyMap<string, Size>, b: ReadonlyMap<string, Size>) => {
  if (a.size !== b.size) return false
  for (const [id, size] of a) {
    const other = b.get(id)
    if (!other || other.w !== size.w || other.h !== size.h) return false
  }
  return true
}
