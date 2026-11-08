import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@shared/api/httpClient'
import { getAccessToken, getTokenSubject } from '@shared/api/authTokens'
import { applyDayReplan, previewDayReplan } from '../api/replanning'
import { buildReplanApplyRequest, validateReplanDelay } from '../utils/replanning'
import type { DayReplanPreview } from '../types/replan'

const actor = () => {
  const token = getAccessToken()
  return token ? getTokenSubject(token) : null
}

/** Mutation stays separate from follow-up refresh: a committed move is never retried as a failure. */
const useDayReplan = (date: string, zoneId: string, onApplied: (ids: number[]) => void) => {
  const [delay, setDelay] = useState('30')
  const [preview, setPreview] = useState<DayReplanPreview | null>(null)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [phase, setPhase] = useState<'idle' | 'preview' | 'apply'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [requiresPreview, setRequiresPreview] = useState(false)
  const [appliedCount, setAppliedCount] = useState<number | null>(null)
  const request = useRef(0)
  const busy = useRef(false)
  const alive = useRef(true)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => {
    alive.current = true
    const cancelRequest = () => {
      ++request.current
      controller.current?.abort()
    }
    let subject = actor()
    const authChanged = () => {
      const next = actor()
      if (next === subject) return
      subject = next
      cancelRequest()
      busy.current = false
      setPhase('idle')
      setPreview(null)
      setSelectedIds([])
      setError(null)
      setAppliedCount(null)
      setRequiresPreview(true)
    }
    window.addEventListener('auth:changed', authChanged)
    return () => {
      alive.current = false
      cancelRequest()
      window.removeEventListener('auth:changed', authChanged)
    }
  }, [])

  const changeDelay = (value: string) => {
    if (busy.current && phase === 'apply') return
    ++request.current
    controller.current?.abort()
    busy.current = false
    setDelay(value)
    setPreview(null)
    setSelectedIds([])
    setError(null)
    setAppliedCount(null)
    setRequiresPreview(false)
    setPhase('idle')
  }

  const loadPreview = async () => {
    if (busy.current) return
    const validation = validateReplanDelay(delay)
    if (validation) { setError(validation); return }
    busy.current = true
    const sequence = ++request.current
    const subject = actor()
    controller.current?.abort()
    controller.current = new AbortController()
    setPhase('preview')
    setError(null)
    setAppliedCount(null)
    // A failed refresh must not revive a previous, possibly committed snapshot.
    setRequiresPreview(true)
    try {
      const next = await previewDayReplan({ date, zoneId, delayMinutes: Number(delay) }, controller.current.signal)
      if (!alive.current || sequence !== request.current || subject !== actor()) return
      setPreview(next)
      setSelectedIds(next.changes.map((change) => change.scheduleId))
      setRequiresPreview(false)
    } catch (err) {
      if (!alive.current || sequence !== request.current || subject !== actor()) return
      setError(err instanceof Error ? err.message : '재배치 제안을 불러오지 못했어요. 다시 시도해 주세요.')
    } finally {
      if (alive.current && sequence === request.current) {
        busy.current = false
        setPhase('idle')
      }
    }
  }

  const toggle = (id: number, selected: boolean) => {
    if (busy.current) return
    setSelectedIds((previous) => selected ? [...new Set([...previous, id])] : previous.filter((value) => value !== id))
    setError(null)
  }

  const applySelection = async () => {
    if (busy.current || !preview || requiresPreview) return
    const payload = buildReplanApplyRequest(preview, selectedIds)
    if (payload.selectedScheduleIds.length === 0) return
    busy.current = true
    const sequence = ++request.current
    const subject = actor()
    setPhase('apply')
    setError(null)
    let applied: number[] | null = null
    try {
      const response = await applyDayReplan(payload)
      if (!alive.current || sequence !== request.current || subject !== actor()) return
      applied = response.appliedScheduleIds
      setAppliedCount(applied.length)
      setPreview(null)
      setSelectedIds([])
      setRequiresPreview(true)
    } catch (err) {
      if (!alive.current || sequence !== request.current || subject !== actor()) return
      const uncertain = !(err instanceof ApiError) || err.status === 0 || err.status >= 500
      setRequiresPreview(uncertain)
      const message = err instanceof Error ? err.message : '변경을 적용하지 못했어요.'
      setError(uncertain
        ? `적용 결과를 확인하지 못했어요. 일정을 확인하고 새 미리보기를 받아 주세요. ${message}`
        : err instanceof ApiError && err.status === 409
          ? `현재 상태에서는 이 동작을 할 수 없어요. ${message} 선택하지 않은 일정과 선행 작업을 확인하거나 새 미리보기를 받아 주세요.`
          : message)
    } finally {
      if (alive.current && sequence === request.current) {
        busy.current = false
        setPhase('idle')
      }
    }
    // Outside mutation catch: refresh failure cannot report that a successful apply failed.
    if (applied) {
      try { await onApplied(applied) } catch {
        if (alive.current && sequence === request.current && subject === actor())
          setError('일정 변경은 저장됐어요. 화면을 갱신하지 못했으니 일정 목록을 다시 열어 주세요.')
      }
    }
  }

  return { delay, changeDelay, preview, selectedIds, toggle, loadPreview, applySelection, phase, error, requiresPreview, appliedCount }
}

export default useDayReplan
