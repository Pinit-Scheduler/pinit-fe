/** 지도에 놓는 조각. `stage`와 `before`는 서버의 검사 결과가 준 값이다. */
export type MapPiece = {
  key: string
  title: string
  /** 보정 후 시간 */
  shownMinutes: number
  over: boolean
  /** 몇 번째 단계인지(0부터) */
  stage: number
  /** 마감. 없으면 null */
  dueDate: string | null
  /** 지도에 있는 조각 중 바로 앞에 오는 조각 */
  before: string[]
  problem: boolean
}

export type MapLayout = {
  nodes: { piece: MapPiece; x: number; y: number }[]
  edges: { key: string; from: string; to: string; d: string }[]
  width: number
  height: number
  worldWidth: number
  worldHeight: number
}

const PAD = 16
const HEIGHT = 92
const GAP_ACROSS = 12
const WIDE_MIN = 148
const WIDE_MAX = 184
const WIDE_GAP = 44
const WIDE_GAP_TIGHT = 28
const NARROW_MIN = 120
const NARROW_MAX = 150
const NARROW_GAP = 30

const span = (count: number, size: number, gap: number) => count * size + (count - 1) * gap

/**
 * 만들 조각을 놓는다. 넓은 화면은 왼쪽에서 오른쪽으로, 좁은 화면(`mobile`)은 위에서 아래로 흐른다.
 * 단계와 이어진 순서는 서버가 준 값을 그대로 놓기만 한다. `room`은 지도 상자의 안쪽 너비이고,
 * 0이면 아직 모르는 것이라 기본(최대) 크기로 놓는다.
 */
export const layoutSplitMap = (
  pieces: MapPiece[],
  { mobile, room }: { mobile: boolean; room: number },
): MapLayout => {
  const layers: MapPiece[][] = []
  pieces.forEach((piece) => (layers[piece.stage] ??= []).push(piece))
  const across = Math.max(1, ...layers.map((layer) => layer.length))
  const height = HEIGHT
  /** count개가 room에 들어가는 카드 너비. min보다 작아지면 줄이지 않고 스크롤에 맡긴다. */
  const fit = (count: number, gap: number, min: number, max: number) =>
    room
      ? Math.max(min, Math.min(max, Math.floor((room - PAD * 2 - (count - 1) * gap) / count)))
      : max
  const roomy = !room || span(layers.length, WIDE_MAX, WIDE_GAP) + PAD * 2 <= room
  const gapAlong = mobile ? NARROW_GAP : roomy ? WIDE_GAP : WIDE_GAP_TIGHT
  const width = mobile
    ? fit(across, GAP_ACROSS, NARROW_MIN, NARROW_MAX)
    : fit(layers.length, gapAlong, WIDE_MIN, WIDE_MAX)
  const acrossSize = mobile ? width : height
  const alongSize = mobile ? height : width
  const nodes = layers.flatMap((layer, along) =>
    layer.map((piece, index) => {
      // 한 단계의 조각 수가 적으면 가운데로 모은다.
      const lead =
        (span(across, acrossSize, GAP_ACROSS) - span(layer.length, acrossSize, GAP_ACROSS)) / 2
      const a = PAD + along * (alongSize + gapAlong)
      const b = PAD + lead + index * (acrossSize + GAP_ACROSS)
      return { piece, x: mobile ? b : a, y: mobile ? a : b }
    }),
  )
  const at = new Map(nodes.map((node) => [node.piece.key, node]))
  const edges = nodes.flatMap((to) =>
    to.piece.before.flatMap((key) => {
      const from = at.get(key)
      if (!from) return []
      const x1 = mobile ? from.x + width / 2 : from.x + width
      const y1 = mobile ? from.y + height : from.y + height / 2
      const x2 = mobile ? to.x + width / 2 : to.x
      const y2 = mobile ? to.y : to.y + height / 2
      const d = mobile
        ? `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2 - 2}`
        : `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2 - 2},${y2}`
      return [{ key: `${key}:${to.piece.key}`, from: key, to: to.piece.key, d }]
    }),
  )
  const alongTotal = span(layers.length, alongSize, gapAlong) + PAD * 2
  const acrossTotal = span(across, acrossSize, GAP_ACROSS) + PAD * 2
  return {
    nodes,
    edges,
    width,
    height,
    worldWidth: mobile ? acrossTotal : alongTotal,
    worldHeight: mobile ? alongTotal : acrossTotal,
  }
}
