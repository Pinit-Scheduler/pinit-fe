import { useEffect, useRef, useState } from 'react'
import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import { useSpaces } from './store'
import type { AllowedActions, SpaceMember } from './types'
import './spaces.css'
export type AffiliationValues = {
  spaceId?: number
  categoryId: number | null
  assigneeId?: number | null
}
type Draft = {
  spaceId: number
  defaultAssignee: { memberId: number; nickname: string }
  members: SpaceMember[]
  allowedActions: AllowedActions
}
export default function AffiliationFields({
  value,
  onChange,
  disabled,
  creating,
  kind = 'task',
  allowedActions,
}: {
  value: AffiliationValues
  onChange: (value: AffiliationValues) => void
  disabled?: boolean
  creating: boolean
  kind?: 'task' | 'schedule'
  allowedActions?: AllowedActions
}) {
  const workspace = useSpaces()
  const spaceId = value.spaceId ?? workspace.selectedSpaceId
  const request = useRef<AbortController | null>(null)
  const callback = useRef(onChange)
  const valueRef = useRef(value)
  const [result, setResult] = useState<{
    key: string
    draft: Draft | null
    error: string | null
  }>({ key: '', draft: null, error: null })
  const [attempt, setAttempt] = useState(0)
  const key = `${spaceId}:${kind}:${attempt}`
  const draft = result.key === key ? result.draft : null
  const error = result.key === key ? result.error : null
  useEffect(() => {
    callback.current = onChange
    valueRef.current = value
  }, [onChange, value])
  useEffect(() => {
    if (spaceId === null || spaceId === undefined) return
    const controller = new AbortController()
    request.current = controller
    void httpClient<Draft>(
      buildApiUrl(`/spaces/${spaceId}/${kind}-draft`, 'v2'),
      { signal: controller.signal },
    )
      .then((result) => {
        if (controller.signal.aborted) return
        setResult({ key, draft: result, error: null })
        const current = valueRef.current
        if (
          current.spaceId === undefined ||
          (creating && current.assigneeId === undefined)
        )
          callback.current({
            ...current,
            spaceId: result.spaceId,
            ...(creating && current.assigneeId === undefined
              ? { assigneeId: result.defaultAssignee.memberId }
              : {}),
          })
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            draft: null,
            error:
              failure instanceof Error
                ? failure.message
                : '소속과 담당자를 불러오지 못했어요.',
          })
      })
    return () => controller.abort()
  }, [spaceId, kind, creating, attempt, key])
  const projects = workspace.projects.filter(
    (project) => project.spaceId === spaceId && !project.deleted,
  )
  const unavailable =
    !workspace.loading &&
    !workspace.error &&
    !workspace.spaces.some((space) => space.id === spaceId && !space.deleted)
  const selectedMemberExists =
    value.assigneeId == null ||
    draft?.members.some((member) => member.memberId === value.assigneeId)
  return (
    <fieldset
      className="space-affiliation"
      disabled={disabled || workspace.loading || unavailable}
    >
      <legend>소속·담당자</legend>
      {workspace.error && (
        <p className="space-error" role="alert">
          {workspace.error}
          <button
            type="button"
            onClick={() => void workspace.reload().catch(() => {})}
          >
            공간 다시 확인
          </button>
        </p>
      )}
      {unavailable && (
        <p role="alert" className="space-error">
          현재 공간에 접근할 수 없어요. 입력한 내용은 유지됩니다. 최신 화면에서
          권한을 확인해 주세요.
        </p>
      )}
      <div className="space-affiliation__fields">
        <label>
          공간
          <select
            disabled={!creating && allowedActions?.move === false}
            value={spaceId ?? ''}
            onChange={(event) => {
              request.current?.abort()
              onChange({
                ...value,
                spaceId: Number(event.target.value),
                categoryId: null,
              })
            }}
          >
            <option value="" disabled>
              공간 선택
            </option>
            {workspace.spaces
              .filter((space) => !space.deleted)
              .map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                  {space.personal ? ' · 본인 전용' : ''}
                </option>
              ))}
          </select>
        </label>
        <label>
          프로젝트
          <select
            disabled={!creating && allowedActions?.move === false}
            value={value.categoryId ?? ''}
            onChange={(event) =>
              onChange({
                ...value,
                categoryId:
                  event.target.value === '' ? null : Number(event.target.value),
              })
            }
          >
            <option value="">프로젝트 없음</option>
            {value.categoryId !== null &&
              !projects.some((project) => project.id === value.categoryId) && (
                <option value={value.categoryId}>
                  현재 프로젝트 · 정보 확인 필요
                </option>
              )}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          담당자
          <select
            disabled={
              !draft ||
              disabled ||
              allowedActions?.assign === false ||
              draft.allowedActions.assign === false
            }
            value={
              value.assigneeId === undefined
                ? 'pending'
                : (value.assigneeId ?? '')
            }
            onChange={(event) =>
              onChange({
                ...value,
                assigneeId:
                  event.target.value === '' ? null : Number(event.target.value),
              })
            }
          >
            {value.assigneeId === undefined && (
              <option value="pending" disabled>
                서버 기본 담당자 확인 중
              </option>
            )}
            <option value="">담당자 미정</option>
            {!selectedMemberExists && (
              <option
                value={
                  value.assigneeId === undefined
                    ? 'pending'
                    : (value.assigneeId ?? '')
                }
              >
                현재 담당자 · 이동 후 변경 필요
              </option>
            )}
            {draft?.members.map((member) => (
              <option key={member.memberId} value={member.memberId}>
                {member.nickname}
                {member.memberId === workspace.memberId ? ' · 나' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!draft && !error && (
        <p className="space-help" role="status">
          서버의 소속·담당자 정보를 확인하고 있어요…
        </p>
      )}
      {error && (
        <div className="space-error" role="alert">
          {error}
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            다시 시도
          </button>
        </div>
      )}
      {!creating && value.spaceId !== undefined && (
        <p className="space-help">
          다른 공간으로 옮기면 연결된 작업·일정이 함께 이동하고, 원래 공간에
          남은 작업과의 선행 관계는 해제·기록됩니다. 같은 공간의 프로젝트만
          바꾸면 선행 관계는 유지됩니다.
        </p>
      )}
      {value.assigneeId === null && (
        <p className="space-help">
          담당자 미정 작업은 공간 목록에 남고 오늘의 내 작업에서는 제외돼요.
        </p>
      )}
    </fieldset>
  )
}
