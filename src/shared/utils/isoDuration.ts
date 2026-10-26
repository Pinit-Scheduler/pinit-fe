// 서버 Duration(ISO-8601, 예: "PT1H30M", "PT0S")과 분 단위 입력값 사이의 변환.
// 의존성이 없어야 node 테스트에서 그대로 불러 쓸 수 있다.

const ISO_DURATION_PATTERN = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/

/** ISO-8601 기간 문자열을 분으로 바꾼다. 형식이 아니면 null. 초는 버린다. */
export const parseIsoDurationMinutes = (value?: string | null): number | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toUpperCase()
  if (!trimmed || trimmed === 'P' || trimmed.endsWith('T')) return null
  const match = trimmed.match(ISO_DURATION_PATTERN)
  if (!match) return null
  const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match
  return Number(days) * 24 * 60 + Number(hours) * 60 + Number(minutes) + Math.floor(Number(seconds) / 60)
}

/** 분을 서버가 받는 ISO-8601 기간 문자열로 바꾼다. 0분은 "PT0S". */
export const minutesToIsoDuration = (minutes: number): string => {
  const safe = Math.max(0, Math.floor(minutes))
  if (safe === 0) return 'PT0S'
  const hours = Math.floor(safe / 60)
  const rest = safe % 60
  return `PT${hours ? `${hours}H` : ''}${rest ? `${rest}M` : ''}`
}

/** 분을 "1시간 30분" 같은 한국어 라벨로 바꾼다. */
export const formatMinutesLabel = (minutes: number): string => {
  const safe = Math.max(0, Math.floor(minutes))
  const hours = Math.floor(safe / 60)
  const rest = safe % 60
  if (hours === 0) return `${rest}분`
  if (rest === 0) return `${hours}시간`
  return `${hours}시간 ${rest}분`
}

/** ISO-8601 기간 문자열을 한국어 라벨로 바꾼다. 읽을 수 없으면 null. */
export const formatIsoDurationLabel = (value?: string | null): string | null => {
  const minutes = parseIsoDurationMinutes(value)
  return minutes === null ? null : formatMinutesLabel(minutes)
}

export const MIN_DURATION_MINUTES = 5
export const MAX_DURATION_MINUTES = 24 * 60

export type DurationInputResult =
  | { kind: 'empty' }
  | { kind: 'value'; minutes: number }
  | { kind: 'invalid'; message: string }

/**
 * 분 입력칸 값을 해석한다. 서버 범위(5분 이상 24시간 이하, 분 단위)를 미리 알려 주기 위한 검사이고,
 * 최종 판단은 서버가 한다. 빈 값(과 작업 예상 소요시간의 0)은 "입력 안 함"이다.
 */
export const parseDurationInput = (raw: string, options: { zeroIsEmpty?: boolean } = {}): DurationInputResult => {
  const trimmed = raw.trim()
  if (!trimmed) return { kind: 'empty' }
  if (!/^\d+$/.test(trimmed)) {
    return { kind: 'invalid', message: '분 단위 정수로 입력하세요.' }
  }
  const minutes = Number(trimmed)
  if (minutes === 0 && options.zeroIsEmpty) return { kind: 'empty' }
  if (minutes < MIN_DURATION_MINUTES || minutes > MAX_DURATION_MINUTES) {
    return { kind: 'invalid', message: '5분 이상 24시간(1440분) 이하로 입력하세요.' }
  }
  return { kind: 'value', minutes }
}
