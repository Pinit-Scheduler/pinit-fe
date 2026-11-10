import { createQueryStore } from '@shared/utils/queryStore'

/**
 * 회원 설정 조회 캐시. 시간대를 바꾸면 앱이 시간대에 묶인 queryStore를 비우는데, 설정은 시간대와 무관하므로 따로 둔다.
 * 그래서 시간대를 바꿔 설정 화면이 다시 그려져도 "불러오는 중"으로 비지 않는다. 키는 useRevalidatingQuery가 계정별로 나눈다.
 */
export const memberStore = createQueryStore()

export const PROFILE_SETTINGS_KEY = 'settings/profile'
