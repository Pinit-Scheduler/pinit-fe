import { currentAccountScope } from '@shared/hooks/useRevalidatingQuery'
import { queryStore } from '@shared/utils/queryStore'
import type { MindMapResponse } from './mindMapApi'

/** 페이지와 홈 카드가 함께 읽는 질의 키. 계정 범위는 질의 저장소가 앞에 붙인다. */
export const MIND_MAP_QUERY_KEY = 'mind-map'

/** 지금 로그인한 계정. 떠난 페이지가 보내지 못한 변경은 같은 계정의 페이지만 이어받는다. */
export const mindMapAccount = (): string => currentAccountScope()

/** 저장에 성공한 나무처럼 화면이 이미 아는 맵을 질의 저장소에 넣는다. `undefined`를 돌려주면 바꾸지 않는다. */
export const rememberMindMap = (
  update: (previous: MindMapResponse | undefined) => MindMapResponse | undefined,
) => queryStore.setData<MindMapResponse>(`${currentAccountScope()}|${MIND_MAP_QUERY_KEY}`, update)

/** 서버의 맵이 화면이 아는 것과 다르다: 질의 저장소의 값을 낡은 것으로 표시해 다음에 읽을 때 다시 받게 한다. */
export const refreshMindMap = () => {
  const key = `${currentAccountScope()}|${MIND_MAP_QUERY_KEY}`
  queryStore.invalidate((candidate) => candidate === key)
}
