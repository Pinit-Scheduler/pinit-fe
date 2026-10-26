/** 가이드 섹션의 묶음 하나. heading은 소제목이 없으면 null이다. */
export type GuideGroup = {
  heading: string | null
  items: string[]
}

/** 기능 하나의 가이드: 동작 방식, 동작 원리, 사용 방법 */
export type OnboardingGuide = {
  behavior: GuideGroup[]
  principle: GuideGroup[]
  usage: GuideGroup[]
}

/** 투어 한 단계. route로 이동해 anchor 요소를 강조한다. */
export type OnboardingTour = {
  route: string
  anchor: string
  purpose: string
  benefit: string
}

export type OnboardingFeature = {
  key: string
  title: string
  /** 이 기능을 투어로 다시 보여 줄 마지막 개정판 */
  revision: number
  tour: OnboardingTour | null
  guide: OnboardingGuide | null
}

/**
 * GET /v2/onboarding 응답(ADR-0017 §5).
 * pendingTour는 서버가 정한 자동 투어 키 목록이며, FE는 노출 규칙을 모르고 그대로 따른다.
 */
export type OnboardingResponse = {
  revision: number
  acknowledgedRevision: number
  pendingTour: string[]
  features: OnboardingFeature[]
}
