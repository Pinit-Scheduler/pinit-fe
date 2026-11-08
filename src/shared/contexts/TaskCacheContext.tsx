import { isSpaceUnavailable, isResourceUnavailable } from '@features/spaces/metadata'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type { Task } from '@features/tasks/types/task'

type TaskCacheValue = {
  tasksById: Record<number, Task>
  setTask: (task: Task) => void
  removeTask: (taskId: number) => void
}

const TaskCacheContext = createContext<TaskCacheValue | null>(null)

export const TaskCacheProvider = ({ children }: { children: ReactNode }) => {
  const [tasksById, setTasksById] = useState<Record<number, Task>>({})

  useEffect(() => {
    const evict = (event: Event) => {
      const ids = new Set(
        (event as CustomEvent<{ spaceIds: number[] }>).detail.spaceIds,
      )
      setTasksById((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(
            ([, task]) => task.spaceId === undefined || !ids.has(task.spaceId),
          ),
        ),
      )
    }
    const evictResources = (event: Event) => {
      const ids = new Set((event as CustomEvent<{ taskIds: number[] }>).detail.taskIds)
      setTasksById((previous) => Object.fromEntries(
        Object.entries(previous).filter(([id]) => !ids.has(Number(id))),
      ))
    }
    window.addEventListener('workspace:access-changed', evict)
    window.addEventListener('workspace:resources-evicted', evictResources)
    return () => {
      window.removeEventListener('workspace:access-changed', evict)
      window.removeEventListener('workspace:resources-evicted', evictResources)
    }
  }, [])
  const setTask = useCallback((task: Task) => {
    if (isSpaceUnavailable(task.spaceId) || isResourceUnavailable('task', task.id, task)) return
    setTasksById((prev) => {
      const current = prev[task.id]
      if (
        current?.version !== undefined &&
        task.version !== undefined &&
        current.version > task.version
      )
        return prev
      return { ...prev, [task.id]: task }
    })
  }, [])

  const removeTask = useCallback((taskId: number) => {
    setTasksById((prev) => {
      const next = { ...prev }
      delete next[taskId]
      return next
    })
  }, [])

  const value = useMemo(
    () => ({
      tasksById,
      setTask,
      removeTask,
    }),
    [tasksById, removeTask, setTask],
  )

  return (
    <TaskCacheContext.Provider value={value}>
      {children}
    </TaskCacheContext.Provider>
  )
}

const useTaskCacheInternal = () => {
  const ctx = useContext(TaskCacheContext)
  if (!ctx) {
    throw new Error('TaskCacheContext not found')
  }
  return ctx
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTaskCache = () => useTaskCacheInternal()
