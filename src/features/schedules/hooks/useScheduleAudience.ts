import { useState } from 'react'
import { useSpaces } from '@features/spaces/store'
import { hasSharedSpace, type ScheduleAudience } from '@features/spaces/scope'

/**
 * 일정 화면의 보기 범위(내 일정/팀 전체). 일정 화면은 모든 스페이스를 보여 주고 기본은 내 일정이다.
 * 화면을 다시 열면 내 일정으로 돌아간다.
 * shared가 false(다른 참여자가 있는 팀 스페이스가 없음)면 전환을 보이지 않고 audience를 쓰지 않는다.
 */
const useScheduleAudience = () => {
  const { spaces } = useSpaces()
  const [audience, setAudience] = useState<ScheduleAudience>('mine')
  return { audience, setAudience, shared: hasSharedSpace(spaces) }
}

export default useScheduleAudience
