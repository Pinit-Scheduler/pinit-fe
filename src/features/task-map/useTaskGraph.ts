import { useCallback, useEffect, useRef, useState } from 'react'
import { useRevalidatingQuery } from '@shared/hooks/useRevalidatingQuery'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { useSpaces } from '@features/spaces/store'
import { collectTaskGraph } from './graphData'
import type { TaskGraphData } from './graphData'
import { taskGraphSource } from './graphApi'

/** Names everything the snapshot depends on: the completed toggle, the zone and the selected scope. */
export const taskGraphKey = (
  includeCompleted: boolean,
  zoneId: string,
  spaceId: number | null | undefined,
  projectId: number | null | undefined,
) =>
  `task-map/${includeCompleted ? 'all' : 'open'}@${zoneId}/${spaceId ?? 'none'}/${projectId ?? 'all'}`

/**
 * Whole-graph snapshot. A task or schedule change refreshes it in place: the previous snapshot
 * stays on screen, with its viewport, until the new one replaces it. Page-count progress is only
 * reported while there is nothing to show yet.
 */
export const useTaskGraph = (includeCompleted: boolean) => {
  const { zoneId } = useTimePreferences()
  const { selectedSpaceId, selectedProjectId } = useSpaces()
  const key = taskGraphKey(includeCompleted, zoneId, selectedSpaceId, selectedProjectId)
  const [progress, setProgress] = useState({ key, count: 0 })
  const showsData = useRef(false)

  const fetcher = useCallback(
    (signal: AbortSignal): Promise<TaskGraphData> =>
      collectTaskGraph(taskGraphSource, includeCompleted, signal, (count) => {
        // A refresh keeps the previous graph on screen, so its progress is never shown.
        if (!signal.aborted && !showsData.current) setProgress({ key, count })
      }),
    [includeCompleted, key],
  )
  const query = useRevalidatingQuery<TaskGraphData>(key, fetcher, {
    invalidateOn: ['task', 'schedule'],
    group: 'task-map/',
    errorMessage: '작업 맵을 불러오지 못했어요.',
  })
  useEffect(() => {
    showsData.current = query.data !== undefined
  }, [query.data])

  const empty = query.data === undefined
  return {
    /** This key's snapshot, kept through refreshes and through a failed refresh. */
    data: query.data ?? null,
    /** Nothing to show for this key yet, and a first load or retry is running. */
    isLoading: empty && (query.isInitialLoading || query.isFetching),
    /** A refresh is running behind the graph on screen. */
    isRefreshing: query.isRefreshing,
    error: query.error,
    count: progress.key === key ? progress.count : 0,
    reload: query.refetch,
    /** The snapshot's key. A change (completed toggle, zone, space, project) is a new map, not a refresh. */
    scopeKey: key,
  }
}
