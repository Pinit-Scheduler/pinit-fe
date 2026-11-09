import type { CSSProperties } from 'react'
import { spaceMark } from './marks'

export default function SpaceMark({
  space,
}: {
  space: { id: number; personal: boolean } | null
}) {
  if (!space) return null
  const color = spaceMark(space)
  if (color === null) {
    return <span className="space-mark space-mark--personal" aria-hidden />
  }
  return (
    <span
      className="space-mark"
      aria-hidden
      style={{ '--space-mark': color } as CSSProperties}
    />
  )
}
