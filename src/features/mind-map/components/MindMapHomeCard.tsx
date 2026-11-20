import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import useRevalidatingQuery from '@shared/hooks/useRevalidatingQuery'
import { tabLinkClick } from '@shared/routing/viewTransitionNavigation'
import { readText, STORAGE_KEYS, writeText } from '@shared/utils/safeStorage'
import { fetchMindMap } from '../api/mindMapApi'
import type { MindMapResponse } from '../api/mindMapApi'
import { MIND_MAP_QUERY_KEY } from '../api/mindMapQuery'
import { afterLeavingSaves } from '../hooks/useMindMapSaver'
import { cardFocus, cardScale, cardTitle, cardView } from '../model/homeCard'
import { drawnBounds, layoutMap } from '../model/layout'
import type { Size } from '../model/layout'
import type { MindMapNode } from '../model/tree'
import type { Frame } from '../model/viewport'
import { MIND_MAP_PATH } from '../paths'
import MindMapWorld from './MindMapWorld'
import { measure, sameSizes } from './measureNodes'
import '../mind-map.css'

const LOAD_FAILED = '마인드맵을 불러오지 못했어요.'

/** 방금 떠난 페이지의 저장이 끝난 뒤에 읽는다(페이지와 같다). 먼저 읽으면 저장 전의 맵을 보인다. */
const fetchAfterLeaving = (signal?: AbortSignal) => afterLeavingSaves().then(() => fetchMindMap(signal))

/** 그림 상자 크기와 그때의 배율(화면 폭으로 정한다). */
type PictureFrame = Frame & { k: number }

/**
 * 카드의 그림: 마지막으로 고른 가지 주변을 읽을 수 있는 배율로. 보기 전용이라 그림 안은 누를 수 없고,
 * 그림 전체가 페이지로 가는 링크다.
 */
function CardPicture({ root, focusId }: { root: MindMapNode; focusId: string }) {
  const previewRef = useRef<HTMLAnchorElement>(null)
  const elements = useRef(new Map<string, HTMLElement>())
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(() => new Map())
  const [frame, setFrame] = useState<PictureFrame | null>(null)
  const [fontsLoaded, setFontsLoaded] = useState(false)
  const layout = useMemo(() => layoutMap(root, sizes), [root, sizes])

  const nodeRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) elements.current.set(id, el)
    else elements.current.delete(id)
  }, [])

  // 글꼴이 늦게 오면 가지 크기가 바뀐다. 다 온 뒤 한 번 더 잰다.
  useEffect(() => {
    let live = true
    document.fonts?.ready.then(() => {
      if (live) setFontsLoaded(true)
    })
    return () => {
      live = false
    }
  }, [])

  // 페이지와 같이, 보이는 가지를 재고 크기가 바뀌었으면 다시 배치한다.
  useLayoutEffect(() => {
    const measured = measure(layout.nodes.map((place) => place.id), elements.current)
    if (!sameSizes(measured, sizes)) setSizes(measured)
  }, [layout, sizes, fontsLoaded])

  // 그림 상자의 크기가 바뀌면(화면 폭, 칸 바꿈) 위치와 배율을 다시 계산한다.
  useLayoutEffect(() => {
    const preview = previewRef.current
    if (!preview) return
    const read = () => {
      const next = { w: preview.clientWidth, h: preview.clientHeight, k: cardScale(window.innerWidth) }
      setFrame((previous) =>
        previous && previous.w === next.w && previous.h === next.h && previous.k === next.k ? previous : next,
      )
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(preview)
    return () => observer.disconnect()
  }, [])

  const focus = layout.boxes.get(focusId)
  const measured = layout.nodes.every((place) => sizes.has(place.id))
  const view = focus && frame && frame.w > 0 && measured ? cardView(drawnBounds(layout), focus, frame, frame.k) : null

  return (
    <Link
      ref={previewRef}
      className="mind-map-card__preview"
      to={MIND_MAP_PATH}
      onClick={tabLinkClick(MIND_MAP_PATH)}
      aria-label="마인드맵 크게 보기"
    >
      <MindMapWorld
        root={root}
        layout={layout}
        selectedId={focusId}
        editing={null}
        readOnly
        nodeRef={nodeRef}
        style={{
          transform: view ? `translate(${view.x}px, ${view.y}px) scale(${view.k})` : undefined,
          visibility: view ? undefined : 'hidden',
        }}
      />
    </Link>
  )
}

/**
 * 오늘 화면의 마인드맵 카드(보기 전용). 맵은 페이지와 같은 질의 키로 카드 안에서 읽는다.
 * 접은 상태는 이 기기에만 기억한다.
 */
export default function MindMapHomeCard() {
  const query = useRevalidatingQuery<MindMapResponse>(MIND_MAP_QUERY_KEY, fetchAfterLeaving, {
    refetchOnFocus: true,
    errorMessage: LOAD_FAILED,
  })
  const [collapsed, setCollapsed] = useState(() => readText(STORAGE_KEYS.mindMapCardCollapsed) === '1')
  const bodyId = useId()
  const map = query.data

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    writeText(STORAGE_KEYS.mindMapCardCollapsed, next ? '1' : '0')
  }

  let body
  if (map && map.root.children.length === 0) {
    body = (
      <div className="mind-map-card__empty">
        <p>큰 일을 가지로 쪼개 보세요.</p>
        <Link className="workspace-button" to={MIND_MAP_PATH} onClick={tabLinkClick(MIND_MAP_PATH)}>
          마인드맵 열기
        </Link>
      </div>
    )
  } else if (map) {
    // 다시 읽기가 실패해도 가진 맵을 그대로 보인다.
    body = <CardPicture root={map.root} focusId={cardFocus(map.root, map.cursorNodeId)} />
  } else if (query.isInitialLoading) {
    body = (
      <p className="mind-map-card__status" role="status">
        마인드맵을 불러오는 중…
      </p>
    )
  } else {
    body = (
      <div className="mind-map-card__status">
        <div className="workspace-inline-error" role="alert">
          <span>{query.error ?? LOAD_FAILED}</span>
          <button type="button" onClick={query.refetch}>
            다시 시도
          </button>
        </div>
      </div>
    )
  }

  return (
    <section className="workspace-panel mind-map-card" aria-label="마인드맵">
      <div className="workspace-panel__head">
        <h2>마인드맵</h2>
        {map && <span className="mind-map-card__about">{cardTitle(map.root, map.cursorNodeId)}</span>}
        <Link className="mind-map-card__open" to={MIND_MAP_PATH} onClick={tabLinkClick(MIND_MAP_PATH)}>
          크게 보기 →
        </Link>
        <button
          type="button"
          className="mind-map-card__fold"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={toggle}
        >
          {collapsed ? '펴기' : '접기'}
        </button>
      </div>
      <div id={bodyId} hidden={collapsed}>
        {!collapsed && body}
      </div>
    </section>
  )
}
