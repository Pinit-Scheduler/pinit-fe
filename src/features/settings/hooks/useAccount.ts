import { useCallback, useEffect, useState } from 'react'

import { fetchAccount, type AccountInfo } from '../api/account'

type UseAccountReturn = {
  account: AccountInfo | null
  isLoading: boolean
  error: string | null
  refetch: () => void
}

const useAccount = (): UseAccountReturn => {
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timestamp, setTimestamp] = useState(() => Date.now())

  useEffect(() => {
    let isMounted = true
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetchAccount()
        if (isMounted) setAccount(response ?? null)
      } catch (err) {
        if (isMounted) setError(err instanceof Error ? err.message : '계정 정보를 불러오지 못했어요.')
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

  return { account, isLoading, error, refetch }
}

export default useAccount
