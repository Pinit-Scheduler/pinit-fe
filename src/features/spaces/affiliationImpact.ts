export type ImpactLine = {
  kind: 'release' | 'share' | 'linked' | 'links'
  text: string
}

type Destination = {
  id: number
  name: string
  personal: boolean
  memberCount: number
}

const isMoving = (
  creating: boolean,
  fromSpaceId: number | undefined,
  toId: number,
) => !creating && fromSpaceId !== undefined && fromSpaceId !== toId

export function affiliationImpact(input: {
  creating: boolean
  kind: 'task' | 'schedule'
  fromSpaceId: number | undefined
  to: Destination
  assignee: { id: number; nickname: string } | null
  destinationMemberIds: number[] | null
  hasLinkedItem: boolean
  dependencyCount: number
}): ImpactLine[] {
  const { to } = input
  const moving = isMoving(input.creating, input.fromSpaceId, to.id)
  const noun = input.kind === 'task' ? '작업' : '일정'
  const lines: ImpactLine[] = []
  if (
    moving &&
    input.assignee &&
    input.destinationMemberIds &&
    !input.destinationMemberIds.includes(input.assignee.id)
  )
    lines.push({
      kind: 'release',
      text: `담당자 ${input.assignee.nickname}님은 ${to.name} 참여자가 아니라서 저장하면 담당이 해제돼요.`,
    })
  if (to.personal) {
    if (moving)
      lines.push({ kind: 'share', text: '나의 스페이스는 나만 볼 수 있어요.' })
  } else if (to.memberCount >= 2)
    lines.push({
      kind: 'share',
      text: `${to.name} 참여자 ${to.memberCount}명이 이 ${noun}을 함께 봐요.`,
    })
  if (moving && input.kind === 'task')
    lines.push({ kind: 'linked', text: '연결된 일정이 있으면 함께 옮겨져요.' })
  else if (moving && input.kind === 'schedule' && input.hasLinkedItem)
    lines.push({ kind: 'linked', text: '연결된 작업도 함께 옮겨져요.' })
  if (moving && input.dependencyCount > 0)
    lines.push({
      kind: 'links',
      text: '다른 스페이스에 남는 이전·다음 작업과의 연결은 해제돼요.',
    })
  return lines
}

export function needsRecordDisclosure(input: {
  creating: boolean
  fromSpaceId: number | undefined
  to: { id: number; personal: boolean }
}) {
  return (
    isMoving(input.creating, input.fromSpaceId, input.to.id) &&
    !input.to.personal
  )
}

export function affiliationSummary(
  space: { name: string } | null,
  project: { name: string } | null,
  assignee: { nickname: string } | null | undefined,
) {
  const place = space
    ? project
      ? `${space.name} › ${project.name}`
      : space.name
    : '스페이스 선택'
  const person =
    assignee === undefined
      ? '담당자 확인 중'
      : assignee === null
        ? '담당자 미정'
        : `담당 ${assignee.nickname}`
  return `${place}, ${person}`
}
