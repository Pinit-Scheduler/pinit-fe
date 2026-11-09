import type { Task } from '@features/tasks/types/task'
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

/**
 * 받은 쪽 뒤의 "서버 목록에서 아직 안 본 첫 위치". 화면에서 걸러진 작업이 있어도
 * 서버가 보낸 행 수로 센다.
 */
export const offsetAfter = (response: {
  number?: number
  size?: number
  numberOfElements?: number
  content: unknown[]
}): number =>
  (response.number ?? 0) * (response.size ?? ASSIGN_PAGE_SIZE) +
  (response.numberOfElements ?? response.content.length)

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
