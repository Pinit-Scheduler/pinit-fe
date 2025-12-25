import { httpClient } from './httpClient'
import { MEMBER_ID } from '../constants/member'

export const fetchMemberZoneOffset = (memberId: number = MEMBER_ID) =>
  httpClient<string>(`/zone-offset?memberId=${memberId}`)
