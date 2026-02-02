import { buildApiUrl } from './config'
import { httpClient } from './httpClient'

export const MEMBER_API_VERSION = 'v2'

export const fetchMemberZoneOffset = () =>
  httpClient<string>(buildApiUrl('/members/zone-offset', MEMBER_API_VERSION))

export const fetchActiveScheduleId = () =>
  httpClient<number | null>(buildApiUrl('/members/now', MEMBER_API_VERSION))
