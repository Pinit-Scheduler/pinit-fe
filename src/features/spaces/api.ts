import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import type {
  Invitation,
  Project,
  ProjectInput,
  Space,
  SpaceInput,
  SpaceMember,
  SpaceSummaries,
  SpaceSummary,
  WeeklyRecord,
  WorkspaceSnapshot,
  AllowedActions,
} from './types'
const url = (path: string) => buildApiUrl(path, 'v2')
type RawSpace = Omit<Space, 'members'>
const actions = (value: AllowedActions): AllowedActions => ({
  ...value,
  update: value.edit,
})
const normalizeSpace = (
  space: RawSpace,
  members: SpaceMember[] = [],
): Space => ({
  ...space,
  deleted: Boolean(space.deletedAt),
  members,
  allowedActions: actions(space.allowedActions),
})
const normalizeProject = (project: Project): Project => ({
  ...project,
  deleted: Boolean(project.deletedAt),
  allowedActions: actions(project.allowedActions),
})
export async function fetchWorkspace(
  signal?: AbortSignal,
): Promise<WorkspaceSnapshot> {
  const index = await httpClient<{
    defaultSpaceId: number
    currentMember: { memberId: number; nickname: string }
    spaces: RawSpace[]
  }>(url('/spaces?includeDeleted=true'), { signal })
  const snapshots = await Promise.all(
    index.spaces.map(async (space) => {
      const detail = await httpClient<{
        space: RawSpace
        projects: Project[]
        members: SpaceMember[]
      }>(url(`/spaces/${space.id}/snapshot?includeDeleted=true`), { signal })
      return {
        space: normalizeSpace(detail.space, detail.members),
        projects: detail.projects.map(normalizeProject),
      }
    }),
  )
  return {
    memberId: index.currentMember.memberId,
    nickname: index.currentMember.nickname,
    defaultSpaceId: index.defaultSpaceId,
    spaces: snapshots.map((snapshot) => snapshot.space),
    projects: snapshots.flatMap((snapshot) => snapshot.projects),
    taskAssignments: {},
    scheduleAssignments: {},
  }
}
export const createSpace = async (input: SpaceInput) =>
  normalizeSpace(
    await httpClient<RawSpace>(url('/spaces'), { method: 'POST', json: input }),
  )
export const updateSpace = async (id: number, input: SpaceInput) =>
  normalizeSpace(
    await httpClient<RawSpace>(url(`/spaces/${id}`), {
      method: 'PATCH',
      json: input,
    }),
  )
export const updatePurpose = async (
  id: number,
  purpose: string | null,
  expectedVersion: number,
) =>
  normalizeSpace(
    await httpClient<RawSpace>(
      url(
        `/spaces/${id}/purpose${purpose === null ? `?expectedVersion=${expectedVersion}` : ''}`,
      ),
      {
        method: purpose === null ? 'DELETE' : 'PUT',
        ...(purpose === null ? {} : { json: { expectedVersion, purpose } }),
      },
    ),
  )
export const deleteSpace = (id: number, expectedVersion: number) =>
  httpClient<void>(url(`/spaces/${id}?expectedVersion=${expectedVersion}`), {
    method: 'DELETE',
  })
export const restoreSpace = (id: number, expectedVersion: number) =>
  httpClient<Space>(url(`/spaces/${id}/restore`), {
    method: 'POST',
    json: { expectedVersion },
  })
export const createProject = (input: ProjectInput) =>
  httpClient<Project>(url('/projects'), { method: 'POST', json: input })
export const updateProject = (
  id: number,
  input: Partial<ProjectInput> & {
    expectedVersion: number
    completed?: boolean
  },
) =>
  httpClient<Project>(url(`/projects/${id}`), { method: 'PATCH', json: input })
export const moveProject = (
  id: number,
  spaceId: number,
  expectedVersion: number,
) =>
  httpClient<Project>(url(`/projects/${id}/move`), {
    method: 'POST',
    json: { spaceId, expectedVersion },
  })
export const deleteProject = (id: number, expectedVersion: number) =>
  httpClient<void>(url(`/projects/${id}?expectedVersion=${expectedVersion}`), {
    method: 'DELETE',
  })
export const restoreProject = (id: number, expectedVersion: number) =>
  httpClient<Project>(url(`/projects/${id}/restore`), {
    method: 'POST',
    json: { expectedVersion },
  })
export const removeSpaceMember = (spaceId: number, memberId: number) =>
  httpClient<void>(url(`/spaces/${spaceId}/members/${memberId}`), {
    method: 'DELETE',
  })
export const updateSpaceMemberRole = (
  spaceId: number,
  memberId: number,
  role: SpaceMember['role'],
) =>
  httpClient<SpaceMember>(url(`/spaces/${spaceId}/members/${memberId}/role`), {
    method: 'PATCH',
    json: { role },
  })
export const leaveSpace = (spaceId: number) =>
  httpClient<void>(url(`/spaces/${spaceId}/leave`), { method: 'POST' })
export async function createInvitation(spaceId: number): Promise<Invitation> {
  const issued = await httpClient<{
    token: string
    url: string
    spaceId: number
    spaceName: string
    expiresAt: string
  }>(url(`/spaces/${spaceId}/invitations`), {
    method: 'POST',
    sensitiveRequest: true,
    sensitiveResponse: true,
  })
  const resolved = new URL(issued.url, window.location.origin)
  if (
    resolved.origin !== window.location.origin ||
    !resolved.pathname.startsWith('/spaces/join/')
  )
    throw new Error('초대 링크를 확인할 수 없어요. 다시 시도해 주세요.')
  return { ...issued, id: issued.token, inviteUrl: resolved.href }
}
export const revokeInvitation = (spaceId: number, token: string) =>
  httpClient<void>(
    url(`/spaces/${spaceId}/invitations/${encodeURIComponent(token)}`),
    { method: 'DELETE', sensitiveRequest: true },
  )
export const previewInvitation = (token: string, signal?: AbortSignal) =>
  httpClient<Invitation>(
    url(`/space-invitations/${encodeURIComponent(token)}`),
    { signal, sensitiveRequest: true, sensitiveResponse: true },
  )
export const acceptInvitation = (token: string) =>
  httpClient<{ spaceId: number; status: 'JOINED' | 'ALREADY_MEMBER' }>(
    url(`/space-invitations/${encodeURIComponent(token)}/accept`),
    { method: 'POST', sensitiveRequest: true, sensitiveResponse: true },
  )
// ADR-0030 읽기 전용 요약. 숫자는 BE가 정의하고 FE는 그대로 보여 준다.
export const fetchSpaceSummaries = (signal?: AbortSignal) =>
  httpClient<SpaceSummaries>(url('/spaces/summaries'), { signal })
export const fetchSpaceSummary = (spaceId: number) =>
  httpClient<SpaceSummary>(url(`/spaces/${spaceId}/summary`))
/** start는 호출자 시간대의 월요일(YYYY-MM-DD). 월요일이 아니면 BE가 400을 준다. */
export const fetchWeeklyRecord = (spaceId: number, start: string) =>
  httpClient<WeeklyRecord>(
    url(`/spaces/${spaceId}/weekly-record?start=${encodeURIComponent(start)}`),
  )
