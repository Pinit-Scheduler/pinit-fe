// 서버 Duration(ISO-8601, 예: "PT1H30M")을 한국어 라벨로 바꾼다. 웹의 src/shared/utils/isoDuration.ts와 같은 규칙이다.

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
