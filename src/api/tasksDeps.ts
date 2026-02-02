import { httpClient } from './httpClient'
import { buildApiUrl } from './config'
import type { Task } from '../types/task'

const TASK_DEPS_API_VERSION = 'v2'

export const fetchTaskDetailForDeps = (taskId: number) =>
  httpClient<Task>(buildApiUrl(`/tasks/${taskId}`, TASK_DEPS_API_VERSION))
