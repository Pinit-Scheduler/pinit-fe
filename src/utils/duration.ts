import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'

dayjs.extend(duration)

export const parseDurationToMinutes = (value?: string): number | null => {
  if (!value) return 0

  const trimmed = value.trim()
  if (!trimmed) return 0

  if (trimmed.startsWith('P')) {
    try {
      const isoDuration = dayjs.duration(trimmed)
      return Math.floor(isoDuration.asMinutes())
    } catch {
      return null
    }
  }

  const hmsMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (hmsMatch) {
    const [, hours = '0', minutes = '0', seconds = '0'] = hmsMatch
    return Math.floor(Number(hours) * 60 + Number(minutes) + Number(seconds) / 60)
  }

  return null
}

export const formatDurationLabel = (value?: string): string => {
  if (!value) return '0분'

  const parsedMinutes = parseDurationToMinutes(value)
  if (parsedMinutes === null) return value

  const hours = Math.floor(parsedMinutes / 60)
  const minutes = parsedMinutes % 60

  if (hours === 0 && minutes === 0) return '0분'
  if (hours === 0) return `${minutes}분`
  if (minutes === 0) return `${hours}시간`
  return `${hours}시간 ${minutes}분`
}
