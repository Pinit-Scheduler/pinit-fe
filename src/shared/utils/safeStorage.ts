// 닫은 안내·"새 기능" 확인 같은 화면 편의 상태를 브라우저 저장소에 둔다.
// 사생활 보호 모드 등에서 저장소 접근이 실패할 수 있으므로 모두 try/catch로 감싸고, 실패하면 기본값을 쓴다.

type FlagStorage = Pick<Storage, 'getItem' | 'setItem'>

const defaultStorage = (): FlagStorage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export const readFlag = (key: string, storage: FlagStorage | null = defaultStorage()): boolean => {
  try {
    return storage?.getItem(key) === '1'
  } catch {
    return false
  }
}

export const writeFlag = (key: string, storage: FlagStorage | null = defaultStorage()): void => {
  try {
    storage?.setItem(key, '1')
  } catch {
    // 저장하지 못해도 화면은 동작한다. 다음에 다시 보일 뿐이다.
  }
}

export const NUDGE_KEYS = {
  /** 설정 목록의 "생활 시간" 새 기능 표시를 확인했다 */
  routinesNewBadgeSeen: 'pinit.routines.newBadgeSeen',
  /** 설정 목록의 "반복 관리" 새 기능 표시를 확인했다(ADR-0019) */
  recurrencesNewBadgeSeen: 'pinit.recurrences.newBadgeSeen',
  /** 계획 화면 상단 생활 시간 안내 카드를 닫았다 */
  planRoutinesCardDismissed: 'pinit.plan.routinesCardDismissed',
  /** 계획 화면 블록의 식사 시간 안내를 닫았다 */
  planMealHintDismissed: 'pinit.plan.mealHintDismissed',
  /** 계획 화면 시간창 기본값 안내를 닫았다 */
  planWindowHintDismissed: 'pinit.plan.windowHintDismissed',
  /** 계획 화면 상단 예상 대비 실제 보정 안내 카드를 닫았다(ADR-0018) */
  planCalibrationCardDismissed: 'pinit.plan.calibrationCardDismissed',
  /** 오늘 화면의 홈 화면 설치 안내를 닫았거나 설치했다 */
  installBannerDismissed: 'pinit.pwa.installBannerDismissed',
} as const
