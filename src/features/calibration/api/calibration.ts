import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import type { TimeCalibrationResponse, WeeklyReviewResponse } from '../types/calibration'

const CALIBRATION_API_VERSION = 'v2'

/** 보정 설정과 최근 90일 기록으로 계산한 난이도별 계수. */
export const fetchTimeCalibration = () =>
  httpClient<TimeCalibrationResponse>(buildApiUrl('/time-calibration', CALIBRATION_API_VERSION))

/** 플래너 보정 켜기·끄기. 409면 다른 곳에서 프로필이 먼저 바뀐 것이다. */
export const updateTimeCalibration = (enabled: boolean) =>
  httpClient<TimeCalibrationResponse>(buildApiUrl('/time-calibration', CALIBRATION_API_VERSION), {
    method: 'PUT',
    json: { enabled },
  })

/** 한 주(회원 시간대 월요일 00:00부터)의 예상 대비 실제. weekStart를 생략하면 이번 주다. */
export const fetchWeeklyReview = (weekStart?: string) => {
  const query = weekStart ? `?${new URLSearchParams({ weekStart }).toString()}` : ''
  return httpClient<WeeklyReviewResponse>(buildApiUrl(`/statistics/weekly-review${query}`, CALIBRATION_API_VERSION))
}
