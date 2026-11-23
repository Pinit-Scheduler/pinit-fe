import { apiUrl } from '@/config'
import { api } from './http'
import type { SpaceIndex } from './types'

/** 지금 진행 중이거나 일시정지한 내 일정의 ID. 없으면 null. */
export const fetchActiveScheduleId = () => api<number | null>(apiUrl('/members/now'))

/** 회원 설정에서 시간대만 읽는다(ADR-0028). */
export const fetchMemberZoneId = async () => {
  const settings = await api<{ zoneId?: string | null } | null>(apiUrl('/members/settings'))
  return settings?.zoneId ?? null
}

/** 내가 속한 스페이스 이름. 카드에 어느 스페이스의 일인지 적는 데 쓴다. */
export const fetchSpaceIndex = async (): Promise<SpaceIndex> => {
  const index = await api<{
    defaultSpaceId: number
    currentMember: { memberId: number; nickname: string }
    spaces: { id: number; name: string }[]
  }>(apiUrl('/spaces'))
  return {
    defaultSpaceId: index.defaultSpaceId,
    memberId: index.currentMember.memberId,
    nickname: index.currentMember.nickname,
    spaces: index.spaces.map(({ id, name }) => ({ id, name })),
  }
}
