import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { getAccessToken, getTokenSubject } from '@shared/api/authTokens'
import { onDataChanged, type ChangeKind, type DataChangeBatch } from '@shared/utils/events'
import {
  queryStore,
  type Fetcher,
  type QueryEntry,
  type QueryStore,
} from '@shared/utils/queryStore'

export type RevalidatingQueryOptions = {
  /** Refetch when these coalesced change events fire. Default: none. */
  invalidateOn?: readonly ChangeKind[]
  /** Return false to ignore a batch (for example, changes to another task). */
  shouldRefetch?: (batch: DataChangeBatch) => boolean
  /**
   * Keys that share this prefix go stale together on an event, e.g. 'schedules/day/' so a moved
   * schedule refreshes the day on screen and marks the other cached days stale.
   * Default: only this key.
   */
  group?: string
  /** Refetch when the window regains focus. Default false. */
  refetchOnFocus?: boolean
  /** Revalidate cached data when the component mounts or the key changes. Default true. */
  revalidateOnMount?: boolean
  /** Turns a failure into the message to show. Default: the server's message as is. */
  errorMessage?: (error: unknown) => string
  /** For tests. Defaults to the app-wide store. */
  store?: QueryStore
}

export type RevalidatingQuery<T> = {
  /** This key's data (fresh or stale). Never another key's data. */
  data: T | undefined
  /** Last failure for this key. With data present, show it inline or as a toast, not instead of the content. */
  error: string | null
  /** No data for this key yet and no failure: the only time to show a loading panel. */
  isInitialLoading: boolean
  /** A request is in flight while data is on screen. Use for aria-busy or a quiet indicator only. */
  isRefreshing: boolean
  /** Any request in flight, with or without data. */
  isFetching: boolean
  /** Refetch now, dropping any response that started earlier. */
  refetch: () => void
  /** Patch this key's data locally, e.g. an optimistic toggle. */
  setData: (update: T | ((previous: T | undefined) => T)) => void
}

const EMPTY_ENTRY: QueryEntry = {
  data: undefined,
  hasData: false,
  error: null,
  fetching: false,
  stale: true,
  updatedAt: 0,
}
const noopUnsubscribe = () => {}

// Keys are scoped by account so one person's cached data can never render for another.
const accountScope = () => {
  const token = getAccessToken()
  return (token && getTokenSubject(token)) || 'guest'
}

let watchingAccount = false
const watchAccount = (store: QueryStore) => {
  if (watchingAccount || typeof window === 'undefined') return
  watchingAccount = true
  let last = accountScope()
  const sync = () => {
    const next = accountScope()
    if (next !== last) store.clear()
    last = next
  }
  window.addEventListener('auth:changed', sync)
  window.addEventListener('storage', sync)
}

/**
 * Stale-while-revalidate data loading. Pass `null` as the key to load nothing.
 * The key must name everything the fetcher depends on (ids, filters, date, zone, space).
 *
 * Render rule:
 *   isInitialLoading ? <StatusPanel variant="loading" />
 *   : error && data === undefined ? <StatusPanel variant="error" />
 *   : <Content data={data} aria-busy={isRefreshing} />
 */
export function useRevalidatingQuery<T>(
  key: string | null,
  fetcher: Fetcher<T>,
  options: RevalidatingQueryOptions = {},
): RevalidatingQuery<T> {
  const {
    invalidateOn,
    group,
    refetchOnFocus = false,
    revalidateOnMount = true,
    store = queryStore,
  } = options
  if (store === queryStore) watchAccount(store)
  const scope = accountScope()
  const scopedKey = key === null ? null : `${scope}|${key}`
  const scopedGroup = group === undefined ? null : `${scope}|${group}`

  const fetcherRef = useRef(fetcher)
  const messageRef = useRef(options.errorMessage)
  const filterRef = useRef(options.shouldRefetch)
  useEffect(() => {
    fetcherRef.current = fetcher
    messageRef.current = options.errorMessage
    filterRef.current = options.shouldRefetch
  })

  const subscribe = useCallback(
    (listener: () => void) =>
      scopedKey ? store.subscribe(scopedKey, listener) : noopUnsubscribe,
    [store, scopedKey],
  )
  const getSnapshot = useCallback(
    () => (scopedKey ? store.get<T>(scopedKey) : (EMPTY_ENTRY as QueryEntry<T>)),
    [store, scopedKey],
  )
  const entry = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    if (!scopedKey) return
    store.register(
      scopedKey,
      (signal) => fetcherRef.current(signal),
      (error) =>
        messageRef.current
          ? messageRef.current(error)
          : error instanceof Error && error.message
            ? error.message
            : '불러오지 못했어요.',
    )
    const current = store.get(scopedKey)
    if (!current.hasData || current.stale || revalidateOnMount) store.revalidate(scopedKey)
  }, [store, scopedKey, revalidateOnMount])

  const invalidate = useCallback(() => {
    if (!scopedKey) return
    if (scopedGroup) store.invalidate((candidate) => candidate.startsWith(scopedGroup))
    // The key itself always refreshes, even when it is outside the group prefix.
    if (!scopedGroup || !scopedKey.startsWith(scopedGroup))
      store.invalidate((candidate) => candidate === scopedKey)
  }, [store, scopedKey, scopedGroup])

  const kinds = invalidateOn?.join(',') ?? ''
  useEffect(() => {
    if (!scopedKey || !kinds) return
    return onDataChanged((batch) => {
      if (filterRef.current && !filterRef.current(batch)) return
      invalidate()
    }, kinds.split(',') as ChangeKind[])
  }, [scopedKey, kinds, invalidate])

  useEffect(() => {
    if (!scopedKey || !refetchOnFocus || typeof window === 'undefined') return
    const onFocus = () => store.revalidate(scopedKey)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [store, scopedKey, refetchOnFocus])

  const setData = useCallback(
    (update: T | ((previous: T | undefined) => T)) => {
      if (scopedKey) store.setData<T>(scopedKey, update)
    },
    [store, scopedKey],
  )

  return {
    data: entry.hasData ? entry.data : undefined,
    error: entry.error,
    isInitialLoading: scopedKey !== null && !entry.hasData && entry.error === null,
    isRefreshing: entry.hasData && entry.fetching,
    isFetching: entry.fetching,
    refetch: invalidate,
    setData,
  }
}

export default useRevalidatingQuery
