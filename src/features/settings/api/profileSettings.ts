import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'

const PROFILE_SETTINGS_API_VERSION = 'v2'

/** 회원 시간대와 하루 목표 작업시간(ADR-0028). dailyObjectiveWork는 ISO-8601 기간 문자열이다. */
export type ProfileSettings = {
  zoneId: string
  dailyObjectiveWork: string
}

export const fetchProfileSettings = () =>
  httpClient<ProfileSettings>(buildApiUrl('/members/settings', PROFILE_SETTINGS_API_VERSION))

/** 준 값만 바꾼다. 400이면 규칙 밖 값, 409면 다른 곳에서 프로필이 먼저 바뀐 것이다. */
export const updateProfileSettings = (change: Partial<ProfileSettings>) =>
  httpClient<ProfileSettings>(buildApiUrl('/members/settings', PROFILE_SETTINGS_API_VERSION), {
    method: 'PATCH',
    json: change,
  })
