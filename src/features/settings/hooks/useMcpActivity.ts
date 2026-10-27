import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchMcpActivity } from '@features/oauth/api/oauth'
import type { McpActivity } from '@features/oauth/types/oauth'

export const MCP_ACTIVITY_PAGE_SIZE = 20

type UseMcpActivityReturn = {
  items: McpActivity[]
  isLoading: boolean
  isLoadingMore: boolean
  error: string | null
  hasMore: boolean
  changesOnly: boolean
  setChangesOnly: (value: boolean) => void
  loadMore: () => void
  refetch: () => void
}

const toMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'AI 사용 이력을 불러오지 못했어요.'

/** AI 사용 이력 첫 페이지와 "더 보기". 필터를 바꾸면 첫 페이지부터 다시 읽는다. */
const useMcpActivity = (): UseMcpActivityReturn => {
  const [items, setItems] = useState<McpActivity[]>([])
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changesOnly, setChangesOnly] = useState(false)
  const [timestamp, setTimestamp] = useState(() => Date.now())
  // 필터를 바꾼 뒤 늦게 도착한 이전 요청의 응답은 버린다.
  const generation = useRef(0)

  useEffect(() => {
    const current = ++generation.current
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const page = await fetchMcpActivity({ size: MCP_ACTIVITY_PAGE_SIZE, changesOnly })
        if (current !== generation.current) return
        setItems(page?.items ?? [])
        setNextCursor(page?.nextCursor ?? null)
      } catch (err) {
        if (current === generation.current) setError(toMessage(err))
      } finally {
        if (current === generation.current) setIsLoading(false)
      }
    }
    load()
  }, [changesOnly, timestamp])

  const loadMore = useCallback(async () => {
    if (nextCursor == null || isLoadingMore) return
    const current = generation.current
    setIsLoadingMore(true)
    try {
      const page = await fetchMcpActivity({ cursor: nextCursor, size: MCP_ACTIVITY_PAGE_SIZE, changesOnly })
      if (current !== generation.current) return
      setItems((previous) => [...previous, ...(page?.items ?? [])])
      setNextCursor(page?.nextCursor ?? null)
    } catch (err) {
      if (current === generation.current) setError(toMessage(err))
    } finally {
      setIsLoadingMore(false)
    }
  }, [changesOnly, isLoadingMore, nextCursor])

  const refetch = useCallback(() => setTimestamp(Date.now()), [])

  return {
    items,
    isLoading,
    isLoadingMore,
    error,
    hasMore: nextCursor != null,
    changesOnly,
    setChangesOnly,
    loadMore,
    refetch,
  }
}

export default useMcpActivity
