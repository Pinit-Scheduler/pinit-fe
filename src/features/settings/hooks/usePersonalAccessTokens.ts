import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  createPersonalAccessToken,
  fetchPersonalAccessTokens,
  revokePersonalAccessToken,
} from '../api/personalAccessTokens'
import type {
  CreatePersonalAccessTokenRequest,
  CreatedPersonalAccessToken,
  PersonalAccessToken,
} from '../types/personalAccessToken'
import { countActiveTokens, toTokenMetadata } from '../utils/personalAccessTokens'

type UsePersonalAccessTokensReturn = {
  tokens: PersonalAccessToken[]
  activeCount: number
  isLoading: boolean
  error: string | null
  refetch: () => void
  /** 평문 토큰이 담긴 응답을 호출자에게만 돌려주고, 훅 상태에는 메타데이터만 남긴다. */
  create: (request: CreatePersonalAccessTokenRequest) => Promise<CreatedPersonalAccessToken>
  revoke: (id: number) => Promise<void>
}

const usePersonalAccessTokens = (): UsePersonalAccessTokensReturn => {
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timestamp, setTimestamp] = useState(() => Date.now())

  useEffect(() => {
    let isMounted = true
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetchPersonalAccessTokens()
        if (isMounted) setTokens(response ?? [])
      } catch (err) {
        if (isMounted) setError(err instanceof Error ? err.message : '토큰 목록을 불러오지 못했어요.')
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

  const create = useCallback(async (request: CreatePersonalAccessTokenRequest) => {
    const created = await createPersonalAccessToken(request)
    setTokens((prev) => [toTokenMetadata(created), ...prev.filter((token) => token.id !== created.id)])
    return created
  }, [])

  const revoke = useCallback(
    async (id: number) => {
      try {
        await revokePersonalAccessToken(id)
      } finally {
        // 성공·실패(404 등) 모두 서버 상태로 다시 맞춘다.
        refetch()
      }
    },
    [refetch],
  )

  // 만료 여부는 렌더 시점 기준으로 계산한다.
  const activeCount = useMemo(() => countActiveTokens(tokens), [tokens])

  return { tokens, activeCount, isLoading, error, refetch, create, revoke }
}

export default usePersonalAccessTokens
