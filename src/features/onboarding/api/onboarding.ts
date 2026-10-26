import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import type { OnboardingResponse } from '../types/onboarding'

const ONBOARDING_API_VERSION = 'v2'

/** 온보딩 콘텐츠와 이 회원의 확인 상태, 지금 자동으로 보여 줄 투어 목록 */
export const fetchOnboarding = () =>
  httpClient<OnboardingResponse>(buildApiUrl('/onboarding', ONBOARDING_API_VERSION))

/** 투어를 완료하거나 건너뛰었을 때 응답의 revision을 확인 처리한다. 서버는 단조 증가로 저장한다(204). */
export const acknowledgeOnboarding = async (revision: number): Promise<void> => {
  await httpClient<void>(buildApiUrl('/onboarding/acknowledgement', ONBOARDING_API_VERSION), {
    method: 'PUT',
    json: { revision },
  })
}
