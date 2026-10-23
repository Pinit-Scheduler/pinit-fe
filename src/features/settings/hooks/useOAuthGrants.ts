import { useCallback, useEffect, useState } from 'react'

import { fetchOAuthGrants, revokeOAuthGrant } from '@features/oauth/api/oauth'
import type { OAuthGrant } from '@features/oauth/types/oauth'

type UseOAuthGrantsReturn = {
  grants: OAuthGrant[]
  isLoading: boolean
  error: string | null
  refetch: () => void
  revoke: (grantId: OAuthGrant['grantId']) => Promise<void>
}

const useOAuthGrants = (): UseOAuthGrantsReturn => {
  const [grants, setGrants] = useState<OAuthGrant[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timestamp, setTimestamp] = useState(() => Date.now())

  useEffect(() => {
    let isMounted = true
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetchOAuthGrants()
        if (isMounted) setGrants(response ?? [])
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
      } finally {
        // 성공·실패(404 등) 모두 서버 상태로 다시 맞춘다.
        refetch()
      }
    },
    [refetch],
  )

  return { grants, isLoading, error, refetch, revoke }
}

export default useOAuthGrants
