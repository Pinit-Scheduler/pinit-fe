import { useState } from 'react'
import { useSpaces } from '@features/spaces/store'
import { audienceFor, type ScheduleAudience } from '@features/spaces/scope'

type StoredAudience = { spaceId: number | null; audience: ScheduleAudience }

/**
 * 팀 스페이스 일정의 보기 범위(내 일정/팀 전체). 기본은 내 일정이고, 스페이스를 바꾸면 내 일정으로 돌아간다.
 * shared가 false(개인 스페이스, 참여자 1명)면 전환을 보이지 않고 audience를 쓰지 않는다.
 */
const useScheduleAudience = () => {
  const { selectedSpaceId, selectedSpace } = useSpaces()
  const [stored, setStored] = useState<StoredAudience | null>(null)
  // 다른 스페이스에 다녀와도 팀 전체가 되살아나지 않도록, 선택이 바뀌면 저장한 값을 버린다.
  if (stored && stored.spaceId !== selectedSpaceId) setStored(null)
  const audience = audienceFor(selectedSpaceId, stored)
  const setAudience = (next: ScheduleAudience) =>
    setStored({ spaceId: selectedSpaceId, audience: next })
  const shared =
    !!selectedSpace &&
    !selectedSpace.personal &&
    selectedSpace.members.length >= 2
  return { audience, setAudience, shared }
}

export default useScheduleAudience
