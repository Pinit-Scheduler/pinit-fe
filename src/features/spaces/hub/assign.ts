import { getRequestFailureMessage } from '@shared/api/errorMessage'
import { ApiError } from '@shared/api/httpClient'
import type { Task } from '@features/tasks/types/task'
import { conflictReloadedMessage, isEditConflict } from '../conflicts'
import { dueLabel } from '../hub'
import type { Project, SpaceMember, UnavailableReason } from '../types'

/** 배정 대화상자가 한 번에 받는 작업 수. */
export const ASSIGN_PAGE_SIZE = 50

export type AssignRow = {
  id: number
  title: string
  /** "{프로젝트}, {M/D 마감}". 없는 부분은 뺀다. */
  detail: string
  version: number | undefined
  /** 서버가 배정을 막았을 때만 거짓. */
  canAssign: boolean
  reason: UnavailableReason | undefined
}

export const assignRows = (
  tasks: Task[],
  projects: Pick<Project, 'id' | 'name'>[],
): AssignRow[] =>
  tasks.map((task) => {
    const project = projects.find((item) => item.id === task.projectId)
    const due = dueLabel(task.dueDate?.date ? task.dueDate.date.slice(0, 10) : null)
    return {
      id: task.id,
      title: task.title,
      detail: [project?.name, due].filter(Boolean).join(', '),
      version: task.version,
      canAssign: task.allowedActions?.assign !== false,
      reason: task.unavailableReasons?.assign,
    }
  })

/** 담당자 고르기. 나를 맨 앞에 "나"로, 나머지는 스페이스 참여자 순서대로. */
export const assigneeOptions = (
  members: Pick<SpaceMember, 'memberId' | 'nickname'>[],
  meId: number | null,
): { value: number; label: string }[] => {
  const me = members.filter((member) => member.memberId === meId)
  const others = members.filter((member) => member.memberId !== meId)
  return [
    ...me.map((member) => ({ value: member.memberId, label: '나' })),
    ...others.map((member) => ({ value: member.memberId, label: member.nickname })),
  ]
}

/** 다음 쪽을 붙인다. 배정해 빠진 만큼 서버 쪽이 당겨지므로 겹치는 작업은 한 번만 둔다. */
export const mergeTasks = (current: Task[], next: Task[]): Task[] => {
  const seen = new Set(current.map((task) => task.id))
  return [...current, ...next.filter((task) => !seen.has(task.id))]
}

/** 받은 쪽 뒤의 "서버 목록에서 아직 안 본 첫 위치". */
export const offsetAfter = (response: {
  number?: number
  size?: number
  content: unknown[]
}): number =>
  (response.number ?? 0) * (response.size ?? ASSIGN_PAGE_SIZE) +
  response.content.length

/**
 * 더 볼 때 받을 쪽. 배정한 작업은 서버 목록에서도 빠지므로 위치를 배정한 수만큼 당긴 값(offset)으로
 * 아직 안 본 첫 작업이 든 쪽을 받는다.
 */
export const nextAssignPage = (offset: number): number =>
  Math.floor(Math.max(0, offset) / ASSIGN_PAGE_SIZE)

/** 고른 담당자가 지금 선택지에 없으면(나간 참여자) 첫 선택지를 쓴다. */
export const chosenAssignee = (
  picked: number | undefined,
  options: { value: number }[],
): number | undefined =>
  options.some((option) => option.value === picked)
    ? picked
    : options[0]?.value

export type AssignState = {
  tasks: Task[]
  hasMore: boolean
  loading: boolean
  /** 목록을 받지 못한 이유. 받으면 비운다. */
  loadError: string | null
  /** 첫 응답을 받았는지. 그전에는 빈 목록 문구를 보이지 않는다. */
  loaded: boolean
  /** 서버 목록에서 아직 안 본 첫 위치. 배정하면 하나 당겨진다. */
  offset: number
  busyId: number | null
  notice: string | null
}

export type AssignAction =
  | { type: 'load' }
  | {
      type: 'loaded'
      replace: boolean
      response: {
        content: Task[]
        number?: number
        size?: number
        last?: boolean
      }
    }
  | { type: 'loadFailed'; message: string }
  | { type: 'assigning'; id: number }
  | { type: 'assigned'; id: number }
  | { type: 'assignFailed'; notice: string }

export const initialAssignState: AssignState = {
  tasks: [],
  hasMore: false,
  loading: true,
  loadError: null,
  loaded: false,
  offset: 0,
  busyId: null,
  notice: null,
}

/** 배정 대화상자의 상태 변화. 화면과 요청 없이 시험할 수 있게 순수 함수로 둔다. */
export function assignReducer(state: AssignState, action: AssignAction): AssignState {
  switch (action.type) {
    case 'load':
      return { ...state, loading: true, loadError: null }
    case 'loaded':
      return {
        ...state,
        tasks: action.replace
          ? action.response.content
          : mergeTasks(state.tasks, action.response.content),
        hasMore: action.response.last === false,
        offset: offsetAfter(action.response),
        loading: false,
        loadError: null,
        loaded: true,
      }
    case 'loadFailed':
      return { ...state, loading: false, loadError: action.message }
    case 'assigning':
      return { ...state, busyId: action.id, notice: null }
    case 'assigned':
      return {
        ...state,
        tasks: state.tasks.filter((task) => task.id !== action.id),
        offset: state.offset - 1,
        busyId: null,
      }
    case 'assignFailed':
      return { ...state, busyId: null, notice: action.notice }
  }
}

const idle = (state: AssignState) =>
  state.loaded && !state.loading && !state.loadError && state.busyId === null

/** 보이는 줄을 다 배정했는데 서버에 남은 쪽이 있으면 바로 다음 쪽을 받는다. */
export const shouldLoadMore = (state: AssignState): boolean =>
  idle(state) && state.tasks.length === 0 && state.hasMore

/** 더 받을 것도 없이 목록이 비었는데 요약은 남았다고 하면 요약이 낡은 것이다. */
export const outOfSync = (state: AssignState, openCount: number | null): boolean =>
  idle(state) &&
  state.tasks.length === 0 &&
  !state.hasMore &&
  openCount !== null &&
  openCount > 0

/**
 * 배정 실패의 안내 문구와, 목록을 처음부터 다시 받아야 하는지.
 * 409·404는 먼저 고쳐졌거나 사라진 작업이라 목록이 낡았다.
 */
export const assignFailure = (
  failure: unknown,
  title: string,
): { notice: string; reload: boolean } => {
  const text = isEditConflict(failure)
    ? conflictReloadedMessage(failure)
    : getRequestFailureMessage(failure, '배정하지 못했어요.')
  const status = failure instanceof ApiError ? failure.status : undefined
  return { notice: `${title}: ${text}`, reload: status === 409 || status === 404 }
}
