import { useCallback, useEffect, useState } from 'react'

import { fetchOAuthGrants, revokeOAuthGrant } from '@features/oauth/api/oauth'
import type { OAuthGrant } from '@features/oauth/types/oauth'
import { oauthGrantsCache } from './memberCache'

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

/**
 * 연결된 앱 목록. 마지막으로 받은 목록이 있으면 바로 보여 주고, 다시 읽는 동안에도 그대로 둔다.
 * 연결을 끊으면 그 앱을 목록에서 바로 빼(사라지는 애니메이션) 서버 목록으로 다시 맞춘다.
 */
const useOAuthGrants = (): UseOAuthGrantsReturn => {
  const [grants, setGrants] = useState<OAuthGrant[]>(() => oauthGrantsCache.read() ?? [])
  const [isLoading, setIsLoading] = useState(() => oauthGrantsCache.read() === undefined)
  const [hasLoaded, setHasLoaded] = useState(() => oauthGrantsCache.read() !== undefined)
  const [error, setError] = useState<string | null>(null)
  const [timestamp, setTimestamp] = useState(() => Date.now())

  useEffect(() => {
    let isMounted = true
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetchOAuthGrants()
        if (!isMounted) return
        setGrants(response ?? [])
        setHasLoaded(true)
        oauthGrantsCache.write(response ?? [])
      } catch (err) {
        if (isMounted) setError(err instanceof Error ? err.message : '연결된 앱을 불러오지 못했어요.')
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }
    load()
    return () => {
      isMounted = false
    }
  }, [timestamp])

  const refetch = useCallback(() => setTimestamp(Date.now()), [])

  const revoke = useCallback(
    async (grantId: OAuthGrant['grantId']) => {
      try {
        await revokeOAuthGrant(grantId)
        setGrants((previous) => previous.filter((grant) => grant.grantId !== grantId))
      } finally {
        // 성공·실패(404 등) 모두 서버 상태로 다시 맞춘다.
        refetch()
      }
    },
    [refetch],
  )

  // 마지막 앱을 끊은 뒤 다시 읽을 때 목록이 비었다고 "불러오는 중"으로 바뀌지 않게, 받은 적이 있으면 로딩이 아니다.
  return { grants, isLoading: isLoading && !hasLoaded, hasLoaded, error, refetch, revoke }
}

export default useOAuthGrants
