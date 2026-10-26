// ADR-0018 예상 대비 실제 보정·주간 리뷰 API wire 형식.
// 길이는 ISO-8601 기간 문자열, 계수·비율·적중률은 소수 둘째 자리 숫자다.

export type FactorSource = 'DIFFICULTY' | 'OVERALL' | 'NONE'

export type DifficultyFactor = {
  difficulty: number
  /** 이 난이도 작업에 곱하는 계수 */
  factor: number
  /** 이 난이도 표본만의 중앙값. 표본이 없으면 null */
  rawMedian: number | null
  sampleCount: number
  source: FactorSource
}

export type TimeCalibrationResponse = {
  /** 플래너가 이 계수를 블록 길이에 쓰는지 */
  enabled: boolean
  windowDays: number
  minSamples: number
  overall: { factor: number; rawMedian: number | null; sampleCount: number }
  /** 난이도 1, 2, 3, 5, 8, 13, 21 오름차순 */
  byDifficulty: DifficultyFactor[]
}

export type WeeklyReviewItem = {
  scheduleId: number
  taskId: number
  title: string
  difficulty: number
  baseDuration: string
  actualDuration: string
  ratio: number
}

export type WeeklyUnmeasured = {
  noTimer: number
  taskCompletedOnly: number
  running: number
  runningElapsed: string
  outlier: number
}

export type WeeklyReviewResponse = {
  /** 주 시작(월요일) YYYY-MM-DD */
  weekStart: string
  zoneId: string
  summary: {
    measuredCount: number
    totalBase: string
    totalActual: string
    medianRatio: number | null
    accuracy: number | null
    previousWeekMedianRatio: number | null
  }
  byDifficulty: { difficulty: number; count: number; medianRatio: number }[]
  overruns: WeeklyReviewItem[]
  underruns: WeeklyReviewItem[]
  unmeasured: WeeklyUnmeasured
  calibration: TimeCalibrationResponse
}
