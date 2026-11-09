import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@shared/api/httpClient'
import { getAccessToken, getTokenSubject } from '@shared/api/authTokens'
import { getSelectedScope } from '@features/spaces/store'
import { evictWorkspaceResource, getResourceRevision } from '@features/spaces/metadata'
import { applyDayReplan, previewDayReplan } from '../api/replanning'
import { buildReplanApplyRequest, validateReplanDelay } from '../utils/replanning'
import type { DayReplanPreview } from '../types/replan'

export type ReplanScope = { spaceId: number; projectId: number | null }
const actor = () => {
  const token = getAccessToken()
  return token ? getTokenSubject(token) : null
}
const sameScope = (scope: ReplanScope) => {
  const selected = getSelectedScope()
  return selected.spaceId === scope.spaceId && selected.projectId === scope.projectId
}
const denied = (error: unknown) => error instanceof ApiError && [401, 403, 404, 410].includes(error.status)

/** Each mounted hook belongs to one member, space, project and membership snapshot. */
const useDayReplan = (
  date: string, zoneId: string, onApplied: (ids: number[]) => void, scope: ReplanScope,
) => {
  const [delay, setDelay] = useState('30')
  const [preview, setPreview] = useState<DayReplanPreview | null>(null)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [phase, setPhase] = useState<'idle' | 'preview' | 'apply'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [requiresPreview, setRequiresPreview] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [appliedCount, setAppliedCount] = useState<number | null>(null)
  const request = useRef(0)
  const busy = useRef(false)
  const work = useRef<'idle' | 'preview' | 'apply'>('idle')
  const alive = useRef(true)
  const controller = useRef<AbortController | null>(null)
  const previewRef = useRef<DayReplanPreview | null>(null)
  const previewRevision = useRef(0)
  const { spaceId, projectId } = scope

  useEffect(() => {
    alive.current = true
    const cancelRequest = () => {
      ++request.current
      controller.current?.abort()
    }
    const invalidate = (lostAccess = false) => {
      cancelRequest()
      busy.current = false
      work.current = 'idle'
      previewRef.current = null
      setPhase('idle')
      setPreview(null)
      setSelectedIds([])
      setError(null)
      setAppliedCount(null)
      setRequiresPreview(true)
      if (lostAccess) setAccessDenied(true)
    }
    let subject = actor()
    const authChanged = () => {
      const next = actor()
      if (next === subject) return
      subject = next
      invalidate()
    }
    const changedScope = () => {
      if (!sameScope({ spaceId, projectId })) invalidate()
    }
    const changedAccess = (event: Event) => {
      const detail = (event as CustomEvent<{ spaceIds?: number[] }>).detail
      if (detail?.spaceIds?.includes(spaceId)) invalidate(true)
    }
    const changedResources = (event: Event) => {
      const detail = (event as CustomEvent<{ scheduleIds?: number[]; taskIds?: number[] }>).detail
      const current = previewRef.current
      const affected = current && (
        [...current.changes, ...current.protectedSchedules, ...current.unplaced].some((item) => detail?.scheduleIds?.includes(item.scheduleId)) ||
        [...current.changes, ...current.unplaced].some((item) => detail?.taskIds?.includes(item.taskId))
      )
      // A pending response also carries the resource revision from request start.
      if (affected || work.current !== 'idle') invalidate()
    }
    window.addEventListener('auth:changed', authChanged)
    window.addEventListener('task:changed', changedScope)
    window.addEventListener('schedule:changed', changedScope)
    window.addEventListener('workspace:access-changed', changedAccess)
    window.addEventListener('workspace:resources-evicted', changedResources)
    return () => {
      alive.current = false
      cancelRequest()
      window.removeEventListener('auth:changed', authChanged)
      window.removeEventListener('task:changed', changedScope)
      window.removeEventListener('schedule:changed', changedScope)
      window.removeEventListener('workspace:access-changed', changedAccess)
      window.removeEventListener('workspace:resources-evicted', changedResources)
    }
  }, [spaceId, projectId])

  const currentRequest = (sequence: number, subject: string | null, revision: number) =>
    alive.current && sequence === request.current && subject === actor() &&
    sameScope(scope) && revision === getResourceRevision()

  const clearPreview = () => {
    previewRef.current = null
    setPreview(null)
    setSelectedIds([])
    setRequiresPreview(true)
  }
  const changeDelay = (value: string) => {
    if (busy.current && work.current === 'apply') return
    ++request.current
    controller.current?.abort()
    busy.current = false
    work.current = 'idle'
    setDelay(value)
    clearPreview()
    setError(null)
    setAppliedCount(null)
    setPhase('idle')
  }

  const loadPreview = async () => {
    if (busy.current || accessDenied || !sameScope(scope)) return
    const validation = validateReplanDelay(delay)
    if (validation) { setError(validation); return }
    busy.current = true
    work.current = 'preview'
    const sequence = ++request.current
    const subject = actor()
    const revision = getResourceRevision()
    controller.current?.abort()
    controller.current = new AbortController()
    setPhase('preview')
    setError(null)
    setAppliedCount(null)
    clearPreview()
    try {
      const next = await previewDayReplan({ ...scope, date, zoneId, delayMinutes: Number(delay) }, controller.current.signal)
      if (!currentRequest(sequence, subject, revision)) return
      if (next.spaceId !== spaceId || next.projectId !== projectId)
        throw new Error('선택한 공간·프로젝트의 제안이 아니에요. 공간을 다시 불러와 주세요.')
      previewRef.current = next
      previewRevision.current = revision
      setPreview(next)
      setSelectedIds(next.changes.map((change) => change.scheduleId))
      setRequiresPreview(false)
    } catch (err) {
      if (!currentRequest(sequence, subject, revision)) return
      if (denied(err)) { clearPreview(); setAccessDenied(true) }
      setError(err instanceof Error ? err.message : '재배치 제안을 불러오지 못했어요. 다시 시도해 주세요.')
    } finally {
      if (alive.current && sequence === request.current) {
        busy.current = false
        work.current = 'idle'
        setPhase('idle')
      }
    }
  }

  const toggle = (id: number, selected: boolean) => {
    if (busy.current || accessDenied) return
    setSelectedIds((previous) => selected ? [...new Set([...previous, id])] : previous.filter((value) => value !== id))
    setError(null)
  }

  const applySelection = async () => {
    if (busy.current || !preview || requiresPreview || accessDenied || !sameScope(scope)) return
    if (previewRevision.current !== getResourceRevision()) { clearPreview(); return }
    const payload = buildReplanApplyRequest(preview, selectedIds)
    if (payload.selectedScheduleIds.length === 0) return
    busy.current = true
    work.current = 'apply'
    const sequence = ++request.current
    const subject = actor()
    const revision = getResourceRevision()
    setPhase('apply')
    setError(null)
    let applied: number[] | null = null
    try {
      const response = await applyDayReplan(payload)
      const current = currentRequest(sequence, subject, revision)
      if (subject !== actor()) return
      if (current) {
        applied = response.appliedScheduleIds
        setAppliedCount(applied.length)
        clearPreview()
        work.current = 'idle'
      }
      // Evict committed IDs after a view switch too; never upsert old-scope data.
      response.appliedScheduleIds.forEach((id) => evictWorkspaceResource('schedule', id, true))
      if (!current) return
    } catch (err) {
      if (!currentRequest(sequence, subject, revision)) return
      const uncertain = !(err instanceof ApiError) || err.status === 0 || err.status >= 500
      if (denied(err)) { clearPreview(); setAccessDenied(true) }
      else setRequiresPreview(uncertain)
      const message = err instanceof Error ? err.message : '변경을 적용하지 못했어요.'
      setError(uncertain
        ? `적용 결과를 확인하지 못했어요. 일정을 확인하고 새 미리보기를 받아 주세요. ${message}`
        : err instanceof ApiError && err.status === 409
          ? `현재 상태에서는 이 동작을 할 수 없어요. ${message} 선택하지 않은 일정과 선행 작업을 확인하거나 새 미리보기를 받아 주세요.`
          : message)
    } finally {
      if (alive.current && sequence === request.current) {
        busy.current = false
        work.current = 'idle'
        setPhase('idle')
      }
    }
    if (applied && alive.current && sequence === request.current && sameScope(scope)) {
      try { await onApplied(applied) } catch {
        if (alive.current && sequence === request.current && subject === actor() && sameScope(scope))
          setError('일정 변경은 저장됐어요. 화면을 갱신하지 못했으니 일정 목록을 다시 열어 주세요.')
      }
    }
  }

  return { delay, changeDelay, preview, selectedIds, toggle, loadPreview, applySelection, phase, error, requiresPreview, accessDenied, appliedCount }
}

export default useDayReplan
