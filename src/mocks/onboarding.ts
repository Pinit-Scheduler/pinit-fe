import type { OnboardingResponse } from '../features/onboarding/types/onboarding'
import { onboardingFixture } from './onboardingFixture'

// 개발용 모크. 노출 규칙의 기준은 서버(ADR-0017 §5 domain/onboarding)이고, 여기서는 같은 규칙을 흉내 낸다.
// 확인 상태는 메모리에만 두므로 새로고침하면 처음 회원처럼 투어가 다시 뜬다.

let acknowledgedRevision = 0

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const errorBody = (status: number, error: string, message: string, path: string) =>
  json({ timestamp: new Date().toISOString(), status, error, message, path: `uri=${path}`, errors: [] }, status)

const readRevision = async (request: Request): Promise<unknown> => {
  try {
    const body = JSON.parse(await request.text()) as { revision?: unknown } | null
    return body?.revision
  } catch {
    return undefined
  }
}

export const handleOnboarding = async (path: string, method: string, request: Request): Promise<Response | null> => {
  if (path === '/v2/onboarding' && method === 'GET') {
    const response: OnboardingResponse = {
      ...onboardingFixture,
      acknowledgedRevision,
      pendingTour: onboardingFixture.features
        .filter((feature) => feature.tour !== null && feature.revision > acknowledgedRevision)
        .map((feature) => feature.key),
    }
    return json(response)
  }

  if (path === '/v2/onboarding/acknowledgement' && method === 'PUT') {
    const revision = await readRevision(request)
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1 || revision > onboardingFixture.revision) {
      return errorBody(400, 'Bad Request', `revision은 1 이상 ${onboardingFixture.revision} 이하여야 합니다.`, path)
    }
    acknowledgedRevision = Math.max(acknowledgedRevision, revision)
    return new Response(null, { status: 204 })
  }

  return null
}
