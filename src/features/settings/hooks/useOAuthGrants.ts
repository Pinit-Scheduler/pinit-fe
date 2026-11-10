import { useCallback } from 'react'

import useRevalidatingQuery from '@shared/hooks/useRevalidatingQuery'
import { fetchOAuthGrants, revokeOAuthGrant } from '@features/oauth/api/oauth'
import type { OAuthGrant } from '@features/oauth/types/oauth'
import { memberStore } from './memberStore'

type UseOAuthGrantsReturn = {
  grants: OAuthGrant[]
  /** 받은 목록이 아직 없는 첫 로딩(또는 실패 뒤 다시 시도)일 때만 참. 다시 읽는 동안에는 거짓이다. */
  isLoading: boolean
  /** 목록을 한 번이라도 받았다(캐시 포함). 빈 목록도 받은 목록이다. */
  hasLoaded: boolean
  error: string | null
  refetch: () => void
  revoke: (grantId: OAuthGrant['grantId']) => Promise<void>
}

const loadGrants = async () => (await fetchOAuthGrants()) ?? []

/**
 * 연결된 앱 목록. 마지막으로 받은 목록이 있으면 바로 보여 주고, 다시 읽는 동안에도 그대로 둔다.
 * 연결을 끊으면 그 앱을 목록에서 바로 빼(사라지는 애니메이션) 서버 목록으로 다시 맞춘다.
 */
const useOAuthGrants = (): UseOAuthGrantsReturn => {
  const { data, error, isInitialLoading, isFetching, refetch, setData } = useRevalidatingQuery<OAuthGrant[]>(
    'settings/oauth-grants',
    loadGrants,
    { store: memberStore, errorMessage: '연결된 앱을 불러오지 못했어요.' },
  )
  const hasLoaded = data !== undefined
  const isRetrying = !hasLoaded && isFetching

  const revoke = useCallback(
    async (grantId: OAuthGrant['grantId']) => {
      try {
        await revokeOAuthGrant(grantId)
        setData((previous) => previous?.filter((grant) => grant.grantId !== grantId))
      } finally {
        // 성공·실패(404 등) 모두 서버 상태로 다시 맞춘다.
        refetch()
      }
    },
    [refetch, setData],
  )

  return {
    grants: data ?? [],
    isLoading: isInitialLoading || isRetrying,
    hasLoaded,
    error: isRetrying ? null : error,
    refetch,
    revoke,
  }
}

export default useOAuthGrants
