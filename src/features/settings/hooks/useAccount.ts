import useRevalidatingQuery from '@shared/hooks/useRevalidatingQuery'
import { fetchAccount, type AccountInfo } from '../api/account'
import { memberStore } from './memberStore'

type UseAccountReturn = {
  account: AccountInfo | null
  isLoading: boolean
  error: string | null
  refetch: () => void
}

/** 계정 정보. 마지막으로 받은 값이 있으면 바로 보여 주고, 다시 읽는 동안에도 그대로 둔다. */
const useAccount = (): UseAccountReturn => {
  const { data, error, isInitialLoading, isFetching, refetch } = useRevalidatingQuery<AccountInfo | null>(
    'settings/account',
    fetchAccount,
    { store: memberStore, errorMessage: '계정 정보를 불러오지 못했어요.' },
  )
  const account = data ?? null
  // 보이던 계정 정보 없이 다시 시도하는 동안에는 지난 실패 대신 로딩을 보인다.
  const isRetrying = account === null && isFetching
  return { account, isLoading: isInitialLoading || isRetrying, error: isRetrying ? null : error, refetch }
}

export default useAccount
