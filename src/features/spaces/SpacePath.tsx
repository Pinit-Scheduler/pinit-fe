import SpaceMark from './SpaceMark'
import { useSpaces } from './store'
import type { cardPath } from './cardPath'
import './spaces.css'

export default function SpacePath({
  path,
}: {
  path: ReturnType<typeof cardPath>
}) {
  const { spaces } = useSpaces()
  if (!path) return null
  const space =
    path.spaceId === null
      ? null
      : (spaces.find((entry) => entry.id === path.spaceId) ?? null)
  return (
    <span className="space-path">
      <SpaceMark space={space} />
      {path.text}
    </span>
  )
}
