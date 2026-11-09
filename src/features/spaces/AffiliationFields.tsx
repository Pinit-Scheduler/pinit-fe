import { useEffect, useId, useRef, useState } from 'react'
import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import {
  affiliationImpact,
  affiliationSummary,
  needsRecordDisclosure,
} from './affiliationImpact'
import SpaceMark from './SpaceMark'
import { useSpaces } from './store'
import UnavailableNote from './UnavailableNote'
import { adminNames, unavailableLines } from './unavailable'
import type {
  AllowedActions,
  SpaceMember,
  UnavailableReasons,
} from './types'
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
  unavailableReasons?: UnavailableReasons
}
export default function AffiliationFields({
  value,
  onChange,
  disabled,
  creating,
  kind = 'task',
  allowedActions,
  unavailableReasons,
  fromSpaceId,
  hasLinkedItem = false,
  dependencyCount = 0,
  recordsConfirmed = false,
  onRecordsConfirmedChange,
  recordsError,
  recordsInputId,
}: {
  value: AffiliationValues
  onChange: (value: AffiliationValues) => void
  disabled?: boolean
  creating: boolean
  kind?: 'task' | 'schedule'
  allowedActions?: AllowedActions
  unavailableReasons?: UnavailableReasons
  /** 폼을 열었을 때의 스페이스. 없으면 옮기는 중이 아니다 */
  fromSpaceId?: number
  hasLinkedItem?: boolean
  dependencyCount?: number
  recordsConfirmed?: boolean
  onRecordsConfirmedChange?: (confirmed: boolean) => void
  recordsError?: string
  recordsInputId?: string
}) {
  const workspace = useSpaces()
  const [open, setOpen] = useState(false)
  const bodyId = useId()
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
  const [seenRecordsError, setSeenRecordsError] = useState(recordsError)
  if (recordsError !== seenRecordsError) {
    // 오류가 새로 생기면 한 번 펼친다. 이후 접는 것은 사용자의 선택이다.
    setSeenRecordsError(recordsError)
    if (recordsError) setOpen(true)
  }
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
  const moveOff = !creating && allowedActions?.move === false
  const assignOff =
    allowedActions?.assign === false || draft?.allowedActions.assign === false
  const admins = adminNames(
    workspace.spaces.find((space) => space.id === spaceId)?.members ?? [],
  )
  const noteLines = unavailableLines(
    [
      { off: moveOff, reason: unavailableReasons?.move },
      {
        off: assignOff,
        reason: unavailableReasons?.assign ?? draft?.unavailableReasons?.assign,
      },
    ],
    admins,
  )
  const destination = workspace.spaces.find(
    (space) => space.id === spaceId && !space.deleted,
  )
  const project = projects.find((item) => item.id === value.categoryId) ?? null
  const knownMembers = [
    ...(draft?.members ?? []),
    ...workspace.spaces.flatMap((space) => space.members),
  ]
  const assignee =
    value.assigneeId === undefined
      ? undefined
      : value.assigneeId === null
        ? null
        : {
            id: value.assigneeId,
            nickname:
              knownMembers.find((member) => member.memberId === value.assigneeId)
                ?.nickname ?? '현재 담당자',
          }
  const summaryAssignee =
    assignee === undefined || (assignee !== null && !draft) ? undefined : assignee
  const impact = destination
    ? affiliationImpact({
        creating,
        kind,
        fromSpaceId,
        to: {
          id: destination.id,
          name: destination.name,
          personal: destination.personal,
          memberCount: destination.members.length,
        },
        assignee: assignee ?? null,
        destinationMemberIds:
          draft?.members.map((member) => member.memberId) ?? null,
        hasLinkedItem,
        dependencyCount,
      })
    : []
  const needsDisclosure = destination
    ? needsRecordDisclosure({ creating, fromSpaceId, to: destination })
    : false
  const expanded = open
  // 입력만 잠근다. 요약 버튼과 다시 시도는 눌려야 불가 사유·영향 안내를 볼 수 있다.
  const locked = disabled || workspace.loading || unavailable
  return (
    <fieldset className="space-affiliation">
      <legend>소속·담당자</legend>
      {workspace.error && (
        <p className="space-error" role="alert">
          {workspace.error}
          <button
            type="button"
            onClick={() => void workspace.reload().catch(() => {})}
          >
            스페이스 다시 확인
          </button>
        </p>
      )}
      {unavailable && (
        <p role="alert" className="space-error">
          현재 스페이스에 접근할 수 없어요. 입력한 내용은 유지됩니다. 최신 화면에서
          권한을 확인해 주세요.
        </p>
      )}
      <button
        type="button"
        className="space-affiliation__summary"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setOpen(!expanded)}
      >
        <SpaceMark space={destination ?? null} />
        <span className="space-affiliation__summary-text">
          {affiliationSummary(destination ?? null, project, summaryAssignee)}
        </span>
        <span className="space-affiliation__summary-action">
          {expanded ? '접기' : '바꾸기'}
        </span>
      </button>
      <div id={bodyId} className="space-affiliation__body" hidden={!expanded}>
      <fieldset className="space-affiliation__fields" disabled={locked}>
        <label>
          스페이스
          <select
            disabled={moveOff}
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
              스페이스 선택
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
            disabled={moveOff}
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
              assignOff
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
      </fieldset>
      {noteLines.map((line) => (
        <UnavailableNote key={line} text={line} />
      ))}
      <ul className="space-affiliation__impact" aria-live="polite">
        {impact.map((line) => (
          <li key={line.kind}>{line.text}</li>
        ))}
      </ul>
      {needsDisclosure && (
        <label className="space-affiliation__confirm">
          <input
            id={recordsInputId}
            type="checkbox"
            disabled={locked}
            checked={recordsConfirmed}
            aria-invalid={Boolean(recordsError)}
            onChange={(event) =>
              onRecordsConfirmedChange?.(event.target.checked)
            }
          />
          <span>이동 전 기록도 참여자에게 보여요. 확인했어요.</span>
        </label>
      )}
      {recordsError && (
        <p className="space-error" role="alert">
          {recordsError}
        </p>
      )}
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
      {value.assigneeId === null && (
        <p className="space-help">
          담당자 미정 작업은 스페이스 목록에 남고 오늘의 내 작업에서는 제외돼요.
        </p>
      )}
    </fieldset>
  )
}
