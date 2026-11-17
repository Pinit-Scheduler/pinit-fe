import { useEffect, useId, useMemo, useState } from 'react'
import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import useMediaQuery from '@shared/hooks/useMediaQuery'
import { formatMinutesLabel } from '@shared/utils/isoDuration'
import type { SplitCheck } from '../api/splitProposals'
import { layoutSplitMap, type MapPiece } from '../utils/splitMapLayout'
import { emptyText } from '../utils/splitProposalLabels'

type SplitMapProps = {
  pieces: MapPiece[]
  emptyReason: SplitCheck['emptyReason']
  activeKey: string | null
  busy: boolean
  formatDay: (date: string) => string
  onActivate: (key: string) => void
  onRemove: (key: string) => void
}

/**
 * 만들 조각만 그리는 작은 지도. 선과 카드 모양은 작업 맵의 것(`tm-*`)을 쓰고, 카드만 작게 배치한다.
 * 단계와 이어진 순서는 서버가 준 값을 그대로 놓기만 한다. 작업 맵의 CSS는 이 지도를 올리는 화면이 불러온다.
 */
const SplitMap = ({
  pieces,
  emptyReason,
  activeKey,
  busy,
  formatDay,
  onActivate,
  onRemove,
}: SplitMapProps) => {
  const mobile = useMediaQuery('(max-width:760px)')
  const markerId = useId().replace(/:/g, '')
  // 지도 상자의 안쪽 너비. 카드를 이 너비에 맞춰 줄여 가로 스크롤을 피한다.
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [room, setRoom] = useState(0)
  useEffect(() => {
    if (!box) return undefined
    const observer = new ResizeObserver(() => setRoom(box.clientWidth))
    observer.observe(box)
    return () => observer.disconnect()
  }, [box])
  const layout = useMemo(() => layoutSplitMap(pieces, { mobile, room }), [pieces, mobile, room])

  if (pieces.length === 0)
    return <div className="split-map split-map--empty">{emptyText(emptyReason)}</div>
  return (
    <div className="split-map" ref={setBox}>
      <div
        className="split-map__canvas"
        style={{ width: layout.worldWidth, height: layout.worldHeight }}
      >
        <svg
          className="tm-edges"
          width={layout.worldWidth}
          height={layout.worldHeight}
          aria-hidden="true"
        >
          <defs>
            <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0 0 L8 4 L0 8 Z" />
            </marker>
          </defs>
          {layout.edges.map((edge) => (
            <path
              key={edge.key}
              className={
                edge.from === activeKey || edge.to === activeKey ? 'tm-edge--active' : undefined
              }
              d={edge.d}
              markerEnd={`url(#${markerId})`}
            />
          ))}
        </svg>
        {layout.nodes.map(({ piece, x, y }) => {
          const active = piece.key === activeKey
          const title = piece.title || '제목 없음'
          return (
            <div
              key={piece.key}
              className="tm-node-slot"
              data-selected={active || undefined}
              style={{
                width: layout.width,
                height: layout.height,
                transform: `translate(${x}px,${y}px)`,
              }}
            >
              <article
                className={`tm-node split-map__node${active ? ' tm-node--selected' : ''}`}
                data-problem={piece.problem || undefined}
                onClick={() => onActivate(piece.key)}
              >
                <button type="button" className="split-map__title" aria-pressed={active}>
                  {title}
                </button>
                <button
                  type="button"
                  className="split-map__remove"
                  aria-label={`${title} 빼기`}
                  title="빼기"
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation()
                    onRemove(piece.key)
                  }}
                >
                  <WorkspaceIcon name="close" />
                </button>
                <span className="split-map__meta" data-warn={piece.over || undefined}>
                  {piece.over && <WorkspaceIcon name="warning" />}
                  {formatMinutesLabel(piece.shownMinutes)}
                  <time dateTime={piece.dueDate}>{formatDay(piece.dueDate)}</time>
                </span>
              </article>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default SplitMap
