import { createContext, useCallback, useContext, useMemo, useState } from 'react'
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

  const setTask = useCallback((task: Task) => {
    setTasksById((prev) => ({ ...prev, [task.id]: task }))
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

  return <TaskCacheContext.Provider value={value}>{children}</TaskCacheContext.Provider>
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
