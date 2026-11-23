import { fetchSpaceIndex } from '@/api/member'
import { useResource } from './resource'

/**
 * 스페이스 ID → 카드에 적을 이름. 개인 스페이스의 일은 이름을 적지 않는다(null).
 * 이름을 받지 못해도 목록은 그대로 보인다.
 */
export const useSpaceNames = () => {
  const { data } = useResource('spaces', () => fetchSpaceIndex(), '스페이스를 불러오지 못했어요.')
  return (spaceId: number): string | null => {
    if (!data || spaceId === data.defaultSpaceId) return null
    return data.spaces.find((space) => space.id === spaceId)?.name ?? null
  }
}
