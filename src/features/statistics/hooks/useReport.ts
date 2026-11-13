import useRevalidatingQuery from '@shared/hooks/useRevalidatingQuery'

export type UseReportReturn<T> = {
  data: T | null
  error: string | null
  /** 요청이 진행 중이다(처음 불러오기 또는 다시 불러오기). 자리 표시는 `isLoading && !data`일 때만. */
  isLoading: boolean
  /** 이 key의 값이 화면에 있는 채로 다시 불러오는 중이다. */
  isRefreshing: boolean
  reload: () => void
}

/**
 * ADR-0025 통계 조회 공통 훅. key가 바뀌거나 일정·작업이 바뀌면 다시 불러온다.
 * load는 key가 같은 동안 같은 요청을 만들어야 한다. 다른 key로 받은 응답은 돌려주지 않는다.
 * 그래서 기간을 넘기면 새 응답이 올 때까지 data는 null이다. 화면 틀을 유지하려면 useHeldValue를 함께 쓴다.
 *
 * 값은 앱 전체 조회 캐시(useRevalidatingQuery)에 key별로 남는다. 다른 보기나 탭에 다녀와도
 * 마지막 값이 바로 보이고 뒤에서 다시 불러온다. 작업·일정 변경은 한 번으로 묶여 한 번만 다시 부른다.
 * key는 앱 전체에서 겹치지 않게 부르는 쪽이 이름을 붙인다(`period:`, `trend:` 등).
 * action은 실패 문구의 앞 문장이다(예: '흐름을 불러오지 못했어요.'). error는 그대로 화면에 보여 준다.
 */
const useReport = <T,>(load: () => Promise<T>, key: string, action: string): UseReportReturn<T> => {
  const query = useRevalidatingQuery<T>(`report/${key}`, () => load(), {
    invalidateOn: ['task', 'schedule'],
    errorMessage: action,
  })
  const hasData = query.data !== undefined
  // 값이 없는 채로 다시 시도하는 동안에는 지난 실패 대신 불러오는 중으로 보인다.
  const error = !hasData && query.isFetching ? null : query.error
  return {
    data: hasData ? (query.data as T) : null,
    error,
    isLoading: query.isInitialLoading || query.isFetching,
    isRefreshing: query.isRefreshing,
    reload: query.refetch,
  }
}

export default useReport
