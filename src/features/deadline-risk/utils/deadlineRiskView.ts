import type { DeadlineRiskItem, DeadlineRiskStatus } from '../types/deadlineRisk'

export const riskStatusLabel = (status: DeadlineRiskStatus | string): string => {
  switch (status) {
    case 'FEASIBLE': return '가정 안에서 배치 가능'
    case 'SHORTAGE': return '시간 부족'
    case 'AT_RISK': return '배치 확인 필요'
    case 'OVERDUE': return '마감 지남'
    default: return '계산 확인 필요'
  }
}

export const riskExplanation = (status: DeadlineRiskStatus | string): string => {
  switch (status) {
    case 'FEASIBLE':
      return '선행 작업의 순서와 연속 작업 시간을 지키는 배치를 찾았어요. 실제 완료를 보장하지는 않아요.'
    case 'SHORTAGE':
      return '마감 전 사용할 수 있는 시간의 상한보다 필요한 시간이 많아요. 마감이나 작업 범위를 확인해 주세요.'
    case 'AT_RISK':
      return '이번 순서로는 연속 시간이나 선행 조건을 맞추지 못했어요. 다른 배치가 가능할 수 있어요.'
    case 'OVERDUE':
      return '이미 마감이 지난 미완료 작업이에요. 마감과 남은 작업을 먼저 확인해 주세요.'
    default:
      return '현재 정보로는 계산을 확정할 수 없어요. 작업과 연결된 선행 작업을 확인해 주세요.'
  }
}

/** Format instants in the server's forecast zone, never the browser's local zone. */
export const forecastTimeLabel = (instant: string, zoneId: string): string => {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: zoneId,
      year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(instant))
  } catch {
    return '시각 확인 필요'
  }
}

/** Keep server ordering; totals must not add overlapping predecessor chains. */
export const forecastCounts = (items: DeadlineRiskItem[]) => ({
  shortage: items.filter((item) => item.status === 'SHORTAGE').length,
  review: items.filter((item) => item.status === 'AT_RISK' || item.status === 'UNKNOWN').length,
  overdue: items.filter((item) => item.status === 'OVERDUE').length,
})
