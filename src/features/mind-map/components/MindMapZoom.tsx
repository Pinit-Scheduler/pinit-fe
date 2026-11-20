import type { PointerEvent } from 'react'

type Props = {
  /** 지금 배율(1이 100%). */
  k: number
  onZoom: (dir: 1 | -1) => void
  onFit: () => void
}

/** 단추를 눌러도 초점이 캔버스에 남게 한다. */
const keepFocus = (event: PointerEvent) => event.preventDefault()

/** 캔버스 오른쪽 위의 축소·배율·확대·전체 보기. */
export default function MindMapZoom({ k, onZoom, onFit }: Props) {
  return (
    <div className="mind-map-zoom" onPointerDown={keepFocus}>
      <button type="button" aria-label="축소" onClick={() => onZoom(-1)}>
        −
      </button>
      <output>{Math.round(k * 100)}%</output>
      <button type="button" aria-label="확대" onClick={() => onZoom(1)}>
        +
      </button>
      <button type="button" onClick={onFit}>
        전체 보기
      </button>
    </div>
  )
}
