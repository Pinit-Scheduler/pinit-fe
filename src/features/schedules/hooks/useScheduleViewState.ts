import { useScheduleViewStateContext } from '@contexts/ScheduleViewStateContext'

/**
 * 일정 탭 전용 ViewState 훅
 * - 전역 ScheduleViewStateProvider를 전제로 동작한다.
 * - Provider 누락 시 명확한 에러를 던져 잘못된 사용을 조기에 발견한다.
 */
const useScheduleViewState = () => useScheduleViewStateContext()

type UseScheduleViewStateReturn = ReturnType<typeof useScheduleViewState>

export type { UseScheduleViewStateReturn }
export default useScheduleViewState
