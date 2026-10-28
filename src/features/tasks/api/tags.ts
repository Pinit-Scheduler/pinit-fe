import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import type { TaskTag } from '../types/task'

/** 회원 태그 API(ADR-0023 §2). 회원당 50개, 작업당 5개, 이름은 1~20자다. */
export const TAG_NAME_MAX_LENGTH = 20
export const TAGS_PER_TASK = 5

export const fetchTags = () => httpClient<TaskTag[]>(buildApiUrl('/tags', 'v2'))

export const createTag = (name: string) =>
  httpClient<TaskTag>(buildApiUrl('/tags', 'v2'), { method: 'POST', json: { name } })

export const renameTag = (tagId: number, name: string) =>
  httpClient<TaskTag>(buildApiUrl(`/tags/${tagId}`, 'v2'), { method: 'PATCH', json: { name } })

export const deleteTag = (tagId: number) =>
  httpClient<void>(buildApiUrl(`/tags/${tagId}`, 'v2'), { method: 'DELETE' })

/** 409 응답의 코드(`TAG_NAME_TAKEN`, `TAG_LIMIT_EXCEEDED`)를 사람이 읽을 문장으로 바꾼다. */
export const tagErrorMessage = (data: unknown, fallback: string) => {
  const errors = (data as { errors?: { rejectedValue?: unknown }[] } | null)?.errors
  const code = Array.isArray(errors) ? errors[0]?.rejectedValue : undefined
  if (code === 'TAG_NAME_TAKEN') return '같은 이름의 태그가 이미 있어요.'
  if (code === 'TAG_LIMIT_EXCEEDED') return '태그는 50개까지 만들 수 있어요.'
  return fallback
}
