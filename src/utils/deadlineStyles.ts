import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { DateWithOffset } from '../types/datetime'
import { getDisplayZoneId, toDayjsFromDateWithOffset } from './datetime'

dayjs.extend(utc)
dayjs.extend(timezone)

const TEXT_COLOR = '#065f46' // 가장 진한 초록으로 고정

// 배경은 짙음~옅음, 텍스트는 동일한 색으로 대비 유지
const SHADE_STEPS = [
  { backgroundColor: '#0f9f77', color: TEXT_COLOR, border: '1px solid #0b7a64' }, // 0~1일 이내 (완료 직전) - 약간 완화된 최강도
  { backgroundColor: '#15b981', color: TEXT_COLOR, border: '1px solid #0f9f77' },
  { backgroundColor: '#22c48f', color: TEXT_COLOR, border: '1px solid #15b981' },
  { backgroundColor: '#34d3a0', color: TEXT_COLOR, border: '1px solid #22c48f' },
  { backgroundColor: '#58ddb1', color: TEXT_COLOR, border: '1px solid #34d3a0' },
  { backgroundColor: '#84e8c7', color: TEXT_COLOR, border: '1px solid #58ddb1' },
  { backgroundColor: '#b4f1dc', color: TEXT_COLOR, border: '1px solid #84e8c7' },
  { backgroundColor: '#e1fbf0', color: TEXT_COLOR, border: '1px solid #b4f1dc' }, // 7일 이상 (가장 옅은 초록)
]

const clampDayIndex = (diffDays: number) => {
  if (diffDays <= 1) return 0
  if (diffDays >= 7) return 7
  // 1 < diff <= 7: 계단식으로 하루 멀어질 때마다 한 단계씩 옅어짐
  return Math.ceil(diffDays) - 1
}

export const getDeadlineStyle = (due: DateWithOffset) => {
  const zoneId = due.zoneId || getDisplayZoneId()
  const now = zoneId ? dayjs().tz(zoneId) : dayjs()
  const target = toDayjsFromDateWithOffset(due, zoneId)
  const diffDays = target.diff(now, 'day', true) // 실수 단위 일수
  const idx = clampDayIndex(diffDays)
  return SHADE_STEPS[idx]
}
