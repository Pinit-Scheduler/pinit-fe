import { Fragment, type ReactNode } from 'react'
import { useListPresence, type PresencePhase } from '@shared/motion'

type PresenceListProps<T> = {
  items: readonly T[]
  getKey: (item: T) => string
  className: string
  /** 목록을 통째로 바꿀 때(예: 날짜 예외의 날짜) 바꾸면, 바뀐 목록을 애니메이션 없이 새 기준으로 삼는다. */
  resetKey?: unknown
  /** 줄 하나를 그린다. 그 `<li>`에 `presenceProps(phase)`를 펼쳐 준다. */
  children: (item: T, phase: PresencePhase) => ReactNode
}

/**
 * 항목을 더하거나 빼면 그 줄만 올라오고 사라진다. 처음 받은 목록은 그대로 보인다.
 * 사라지는 줄까지 모두 끝나 비면 `<ul>`도 그리지 않아, 빈 목록이 카드에 간격만 남기지 않는다.
 */
const PresenceList = <T,>({ items, getKey, className, resetKey, children }: PresenceListProps<T>) => {
  const rows = useListPresence(items, getKey, { resetKey })
  if (rows.length === 0) return null
  return (
    <ul className={className}>
      {rows.map(({ key, item, phase }) => (
        <Fragment key={key}>{children(item, phase)}</Fragment>
      ))}
    </ul>
  )
}

export default PresenceList
