import { presenceProps, useListPresence } from '@shared/motion'
import SpaceMark from '../SpaceMark'
import { railLine } from '../hub'
import type { Space, SpaceSummaries } from '../types'
import Count from './Count'

export default function HubRail({
  spaces,
  summaries,
  failed,
  onRetry,
  selectedId,
  onSelect,
}: {
  spaces: Space[]
  summaries: SpaceSummaries | null
  failed: boolean
  onRetry: () => void
  selectedId: number | null
  onSelect: (spaceId: number) => void
}) {
  // A space created, joined, left or deleted rises in or fades out where it was.
  const rows = useListPresence(spaces.length ? spaces : undefined, (space) => space.id)
  return (
    <nav className="hub-rail" aria-label="스페이스 목록">
      <ul>
        {rows.map(({ key, item: space, phase }) => {
          const line = railLine(
            space,
            summaries?.spaces.find((row) => row.spaceId === space.id),
          )
          const current = space.id === selectedId
          return (
            <li key={key} {...presenceProps(phase)}>
              <button
                type="button"
                className="hub-rail__item"
                data-space-id={space.id}
                aria-current={current ? 'true' : undefined}
                onClick={() => onSelect(space.id)}
              >
                <SpaceMark space={space} />
                <span className="hub-rail__copy">
                  <strong>{space.name}</strong>
                  {line.who && <small>{line.who}</small>}
                </span>
                <span
                  className="hub-rail__count"
                  data-pending={line.open === '–' || undefined}
                >
                  <span aria-hidden>
                    {line.open === '–' ? line.open : <Count value={Number(line.open)} />}
                  </span>
                  <span className="sr-only">
                    {line.open === '–'
                      ? '미완료 작업 수 없음'
                      : `미완료 작업 ${line.open}개`}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {failed ? (
        <p className="hub-load-error" role="alert">
          숫자를 불러오지 못했어요.{' '}
          <button type="button" className="space-text-button" onClick={onRetry}>
            다시 시도
          </button>
        </p>
      ) : (
        <p className="hub-rail__note">숫자는 아직 끝나지 않은 작업 수예요.</p>
      )}
    </nav>
  )
}
