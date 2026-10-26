// 투어 단계 구성과 종료 판정. node:test가 그대로 불러오므로 import 없이 쓴다.
// 아래 타입은 OnboardingResponse(types/onboarding.ts)와 구조만 맞춘 것이다.

type TourContent = { route: string; anchor: string; purpose: string; benefit: string }
type TourFeature = { key: string; title: string; revision: number; tour: TourContent | null }
type TourResponse = { acknowledgedRevision: number; features: readonly TourFeature[] }

export type TourStep = {
  key: string
  title: string
  route: string
  anchor: string
  purpose: string
  benefit: string
  isNew: boolean
}

const ANCHOR_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/

/** 확인한 개정판이 1 이상이고 기능이 그 뒤에 개정됐을 때만 NEW다. 처음 보는 회원에게는 붙이지 않는다. */
export const isFeatureNew = (response: TourResponse, feature: TourFeature): boolean =>
  response.acknowledgedRevision >= 1 && feature.revision > response.acknowledgedRevision

/** tour가 있는 기능의 key를 응답 순서대로 */
export const allTourKeys = (response: TourResponse): string[] =>
  response.features.filter((feature) => feature.tour !== null).map((feature) => feature.key)

/** keys 순서대로 단계를 만든다. 응답에 없는 key와 tour가 없는 key는 건너뛴다. */
export const buildTourSteps = (response: TourResponse, keys: readonly string[]): TourStep[] => {
  const byKey = new Map(response.features.map((feature) => [feature.key, feature]))
  const steps: TourStep[] = []
  for (const key of keys) {
    const feature = byKey.get(key)
    if (!feature || !feature.tour) continue
    steps.push({
      key: feature.key,
      title: feature.title,
      route: feature.tour.route,
      anchor: feature.tour.anchor,
      purpose: feature.tour.purpose,
      benefit: feature.tour.benefit,
      isNew: isFeatureNew(response, feature),
    })
  }
  return steps
}

/** 서버 형식(ADR-0017 §2)에 맞는 앵커만 CSS 선택자로 바꾼다. 따옴표 등이 섞이면 null이다. */
export const anchorSelector = (anchor: string): string | null =>
  ANCHOR_PATTERN.test(anchor) ? `[data-onboarding-anchor="${anchor}"]` : null

/** 투어가 기대한 경로에서 벗어났는지(예: 브라우저 뒤로 가기). 기대 경로가 없으면 끝내지 않는다. */
export const shouldEndTour = (expectedPath: string | null, pathname: string): boolean =>
  expectedPath !== null && expectedPath !== pathname
