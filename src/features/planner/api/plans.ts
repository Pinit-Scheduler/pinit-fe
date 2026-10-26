import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import type { DayPlanResponse, PlanApplyRequest, PlanApplyResponse } from '../types/plan'

const PLAN_API_VERSION = 'v2'

type DayPlanParams = {
  /** 계획일 YYYY-MM-DD */
  date: string
  /** IANA 시간대. 서버는 회원 설정으로 대체하지 않으므로 항상 보낸다 */
  zoneId: string
  /** 마감일 범위(일). 생략하면 서버 기본 7 */
  horizonDays?: number
}

/** 하루 계획 제안. 서버는 아무것도 저장하지 않는다. */
export const fetchDayPlan = ({ date, zoneId, horizonDays }: DayPlanParams) => {
  const query = new URLSearchParams({ date, zoneId })
  if (horizonDays !== undefined) query.set('horizonDays', String(horizonDays))
  return httpClient<DayPlanResponse>(buildApiUrl(`/plans?${query.toString()}`, PLAN_API_VERSION))
}

/**
 * 사용자가 고른 블록 승인. 201이면 블록마다 일정이 생기고, 하나라도 거부되면 409(ApiError.data.rejections)이며
 * 아무 일정도 만들어지지 않는다.
 */
export const applyDayPlan = (payload: PlanApplyRequest) =>
  httpClient<PlanApplyResponse>(buildApiUrl('/plans/apply', PLAN_API_VERSION), {
    method: 'POST',
    json: payload,
  })
