import { formatIsoDurationLabel, parseIsoDurationMinutes } from '@shared/utils/isoDuration'

// ADR-0018 보정 계수와 주간 리뷰를 화면 문구로 옮기는 순수 함수 모음. 계산 규칙은 서버(domain/calibration)에 있고,
// 여기서는 표시만 한다. node 테스트가 그대로 불러 쓰도록 isoDuration 외에는 의존하지 않는다.

type Source = 'DIFFICULTY' | 'OVERALL' | 'NONE'

export const SOURCE_LABEL: Record<Source, string> = {
  DIFFICULTY: '같은 난이도 기록',
  OVERALL: '전체 기록',
  NONE: '기록 부족',
}

/** 1.6 → "×1.6", 1.0 → "×1". 값이 없으면 "-". */
export const formatFactor = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return `×${Number(value.toFixed(2))}`
}

/** 0.75 → "75%". 값이 없으면 "-". */
export const formatAccuracy = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return `${Math.round(value * 100)}%`
}

type BlockLength = {
  duration: string
  baseDuration?: string
  calibrationFactor?: number
  factorSource?: Source | string
}

/**
 * 보정으로 길이가 바뀐 블록이면 "예상 45분 → 1시간 15분 (같은 난이도 기록 ×1.6)"을, 아니면 null을 돌려준다.
 * 보정 필드가 없는 이전 서버 응답도 null이다.
 */
export const blockCalibrationNote = (block: BlockLength): string | null => {
  const base = parseIsoDurationMinutes(block.baseDuration)
  const length = parseIsoDurationMinutes(block.duration)
  if (base === null || length === null || base === length) return null
  if (typeof block.calibrationFactor !== 'number' || block.calibrationFactor === 1) return null
  const source = block.factorSource === 'OVERALL' ? SOURCE_LABEL.OVERALL : SOURCE_LABEL.DIFFICULTY
  return `예상 ${formatIsoDurationLabel(block.baseDuration)} → ${formatIsoDurationLabel(block.duration)} (${source} ${formatFactor(block.calibrationFactor)})`
}

/** 기록으로 만든 계수가 하나라도 있는지. 보정 적용 안내를 띄울지 정한다. */
export const hasUsableFactor = (calibration: { byDifficulty?: { source: string }[] } | null | undefined): boolean =>
  Array.isArray(calibration?.byDifficulty) && calibration.byDifficulty.some((factor) => factor.source !== 'NONE')

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** 날짜(YYYY-MM-DD)가 속한 주의 월요일. 읽을 수 없으면 null. */
export const weekStartOf = (date: string): string | null => {
  const match = DATE_PATTERN.exec(date)
  if (!match) return null
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (Number.isNaN(utc.getTime())) return null
  const daysSinceMonday = (utc.getUTCDay() + 6) % 7
  utc.setUTCDate(utc.getUTCDate() - daysSinceMonday)
  return utc.toISOString().slice(0, 10)
}

/** 비율 중앙값을 한 문장으로. ±5% 안은 "거의 같았어요". */
export const ratioSentence = (medianRatio: number | null | undefined): string => {
  if (typeof medianRatio !== 'number') return '이번 주에는 측정된 일정이 없어요.'
  if (medianRatio > 1.05) return `예상보다 보통 ${Number(medianRatio.toFixed(2))}배 걸렸어요.`
  if (medianRatio < 0.95) return `예상보다 보통 빨리 끝났어요 (${formatFactor(medianRatio)}).`
  return '예상과 거의 같았어요.'
}

type Unmeasured = {
  noTimer: number
  taskCompletedOnly: number
  running: number
  runningElapsed: string
  outlier: number
}

/** 측정되지 않은 일정을 사유별 한 줄씩. 건수가 0인 사유는 뺀다. */
export const unmeasuredLines = (unmeasured: Unmeasured): string[] => {
  const lines: string[] = []
  if (unmeasured.noTimer > 0) lines.push(`타이머 없이 완료 ${unmeasured.noTimer}건 · 시작을 누르고 완료하면 측정돼요`)
  if (unmeasured.taskCompletedOnly > 0) lines.push(`작업만 완료하고 일정은 끝내지 않음 ${unmeasured.taskCompletedOnly}건`)
  if (unmeasured.running > 0) {
    lines.push(`진행 중·일시정지 ${unmeasured.running}건 (지금까지 ${formatIsoDurationLabel(unmeasured.runningElapsed) ?? '-'})`)
  }
  if (unmeasured.outlier > 0) lines.push(`예상과 너무 달라 제외 ${unmeasured.outlier}건`)
  return lines
}

/** 난이도 계수 한 줄. 출처가 전체 기록이면 그렇다고 적는다. */
export const factorRow = (factor: { difficulty: number; factor: number; sampleCount: number; source: string }) => ({
  difficulty: `난이도 ${factor.difficulty}`,
  factor: formatFactor(factor.factor),
  detail:
    factor.source === 'NONE'
      ? SOURCE_LABEL.NONE
      : factor.source === 'OVERALL'
        ? `기록 ${factor.sampleCount}건 · 전체 기록 사용`
        : `기록 ${factor.sampleCount}건`,
})
