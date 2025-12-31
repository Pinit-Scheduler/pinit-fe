import { buildApiUrl } from './config'
import { httpClient } from './httpClient'

export const fetchMemberZoneOffset = () =>
  httpClient<string>(buildApiUrl('/zone-offset'))
