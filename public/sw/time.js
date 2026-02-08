self.pinitSw = self.pinitSw || {}

const { KST_TIMEZONE } = self.pinitSw.constants

const KST_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: KST_TIMEZONE,
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const parseUtcDate = (value) => {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === 'number') {
    const timestamp = value < 1e12 ? value * 1000 : value
    const date = new Date(timestamp)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const hasTimezone = /[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed)
  if (hasTimezone) {
    const date = new Date(trimmed)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const normalized = trimmed.replace(' ', 'T')
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?)?$/,
  )

  if (match) {
    const year = Number(match[1])
    const month = Number(match[2]) - 1
    const day = Number(match[3])
    const hour = Number(match[4] || 0)
    const minute = Number(match[5] || 0)
    const second = Number(match[6] || 0)
    const ms = match[7] ? Number(match[7].padEnd(3, '0')) : 0
    const date = new Date(Date.UTC(year, month, day, hour, minute, second, ms))
    return Number.isNaN(date.getTime()) ? null : date
  }

  const fallback = new Date(`${trimmed}Z`)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

const formatStartTime = (value) => {
  const date = parseUtcDate(value)
  if (!date) return null
  return KST_FORMATTER.format(date)
}

self.pinitSw.time = {
  parseUtcDate,
  formatStartTime,
}
