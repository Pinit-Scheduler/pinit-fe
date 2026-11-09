import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import type { DeadlineRiskDays, DeadlineRiskResponse } from '../types/deadlineRisk'

/** Read only; never fall back to a stored forecast when the network fails. */
export const fetchDeadlineRisk = (days: DeadlineRiskDays, signal?: AbortSignal) =>
  httpClient<DeadlineRiskResponse>(
    buildApiUrl(`/plans/deadline-risk?days=${days}`, 'v2'),
    { cache: 'no-store', signal },
  )
