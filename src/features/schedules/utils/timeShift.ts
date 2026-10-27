import type dayjs from 'dayjs'

// 일정 카드의 시간 손잡이를 위아래로 끌어 시작 시각을 옮긴다. 30분 단위로 붙는다.
export const TIME_STEP_MINUTES = 30
// 손가락으로 한 칸(30분)을 옮기는 데 필요한 세로 거리(px).
export const TIME_STEP_PX = 28

/** 세로 이동 거리를 30분 칸 수로 바꾼다. 아래로 끌면 늦어진다. */
export const stepsFromDelta = (deltaY: number, stepPx: number = TIME_STEP_PX) => {
  const steps = Math.trunc(deltaY / stepPx)
  return steps === 0 ? 0 : steps // -0을 0으로
}

/**
 * 시작 시각을 minutes만큼 옮기되 같은 날 안에 둔다(00:00 ~ 23:30).
 * 날짜를 바꾸는 이동은 좌우 끌기(전날·다음날)가 맡는다.
 */
export const shiftWithinDay = (start: dayjs.Dayjs, minutes: number): dayjs.Dayjs => {
  const dayStart = start.startOf('day')
  const latest = dayStart.add(24 * 60 - TIME_STEP_MINUTES, 'minute')
  const next = start.add(minutes, 'minute')
  if (next.isBefore(dayStart)) return dayStart
  if (next.isAfter(latest)) return latest
  return next
}

/** 실제로 옮겨진 분(경계에 막히면 요청보다 작다). */
export const appliedShiftMinutes = (start: dayjs.Dayjs, minutes: number) => shiftWithinDay(start, minutes).diff(start, 'minute')

export const formatShift = (minutes: number) => {
  if (minutes === 0) return '그대로'
  const sign = minutes > 0 ? '+' : '−'
  const abs = Math.abs(minutes)
  const hours = Math.floor(abs / 60)
  const rest = abs % 60
  const parts = [hours ? `${hours}시간` : '', rest ? `${rest}분` : ''].filter(Boolean)
  return `${sign}${parts.join(' ')}`
}
