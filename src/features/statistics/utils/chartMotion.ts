// 통계 차트의 움직임 값. 막대와 도넛은 크기(width·height) 대신 transform과 stroke-dashoffset만 바뀐다.
// node 테스트가 그대로 불러 쓰도록 의존성을 두지 않는다.

const clampRatio = (ratio: number) =>
  Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0

/**
 * 트랙 안에서 막대를 밀어 넣는 거리(%). 0~1 비율의 나머지만큼 막대를 트랙 밖으로 민다.
 * 막대 자체는 트랙 크기 그대로라 모서리가 늘어나지 않고, 새 값으로 미끄러지듯 옮겨 간다.
 */
export const barHiddenPercent = (ratio: number): number =>
  Math.round((1 - clampRatio(ratio)) * 1000) / 10

/** 세로 막대의 높이 비율. 값이 있으면 최소 높이(minRatio)를 보장한다. */
export const columnRatio = (value: number, max: number, minRatio = 0): number => {
  if (!(max > 0) || !(value > 0)) return minRatio
  return Math.max(minRatio, clampRatio(value / max))
}

/**
 * 도넛 고리 두 겹의 stroke-dashoffset(pathLength 100 기준).
 * 아래 겹은 배분된 전체(집중+행정), 위 겹은 집중 작업만 칠한다. 둘 다 12시 방향에서 시작한다.
 */
export const donutOffsets = (deepPercent: number, adminPercent: number) => {
  const deep = Math.min(100, Math.max(0, deepPercent))
  const allocated = Math.min(100, Math.max(0, deep + Math.max(0, adminPercent)))
  return { deep: 100 - deep, allocated: 100 - allocated }
}

/** 기간 이동 방향. 지난 기간은 왼쪽에서, 다음 기간은 오른쪽에서 들어온다. */
export const periodDirection = (previous: string, next: string): -1 | 0 | 1 =>
  previous === next ? 0 : next < previous ? -1 : 1
