import { useCallback, useEffect, useState } from 'react'

import { fetchAccount, type AccountInfo } from '../api/account'
import { accountCache } from './memberCache'

type UseAccountReturn = {
  account: AccountInfo | null
  isLoading: boolean
  error: string | null
  refetch: () => void
}

/** 계정 정보. 마지막으로 받은 값이 있으면 바로 보여 주고, 다시 읽는 동안에도 그대로 둔다. */
const useAccount = (): UseAccountReturn => {
  const [account, setAccount] = useState<AccountInfo | null>(() => accountCache.read() ?? null)
  const [isLoading, setIsLoading] = useState(() => accountCache.read() === undefined)
  const [error, setError] = useState<string | null>(null)
  const [timestamp, setTimestamp] = useState(() => Date.now())

  useEffect(() => {
    let isMounted = true
    const load = async () => {
      setError(null)
      try {
        const response = await fetchAccount()
        if (!isMounted) return
        setAccount(response ?? null)
        if (response) accountCache.write(response)
      } catch (err) {
        if (isMounted) setError(err instanceof Error && err.message ? err.message : '계정 정보를 불러오지 못했어요.')
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }
    load()
    return () => {
      isMounted = false
    }
  }, [timestamp])

  // 다시 시도할 때만 로딩을 다시 보인다(보이던 계정 정보가 없을 때).
  const refetch = useCallback(() => {
    setIsLoading((loading) => loading || accountCache.read() === undefined)
    setTimestamp(Date.now())
  }, [])

  return { account, isLoading, error, refetch }
}

export default useAccount
