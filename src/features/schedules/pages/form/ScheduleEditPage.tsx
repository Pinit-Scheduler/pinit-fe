import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ScheduleForm from '../../components/ScheduleForm'
import { toApiDateTimeWithZone, toDateFromApi } from '@shared/utils/datetime'
import type { ScheduleFormValues, ScheduleResponse } from '../../types/schedule'
import useScheduleDetail from '../../hooks/useScheduleDetail'
import { useToast } from '@contexts/ToastContext'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import './ScheduleFormPage.css'
import { updateSchedule } from '../../api/schedules'
import { dispatchScheduleChanged } from '@shared/utils/events'
import { minutesToIsoDuration, parseDurationInput, parseIsoDurationMinutes } from '@shared/utils/isoDuration'
import { toDateKey, toDisplayDayjs } from '@shared/utils/datetime'
import { useRecurrenceScope } from '@features/recurrence/components/RecurrenceScopeDialog'
import { confirmAndUpdateSeries } from '@features/recurrence/utils/seriesMutations'
import { fixedChanges } from '@features/recurrence/utils/recurrenceRules'

const ScheduleEditPage = () => {
  const { scheduleId } = useParams()
  const navigate = useNavigate()
  const { addToast } = useToast()
  const { schedule, isLoading, error } = useScheduleDetail(scheduleId)
  const { offsetMinutes } = useTimePreferences()
  const recurrenceScope = useRecurrenceScope()

  const handleClose = useCallback(() => {
    if (window.history.state && window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/app/schedules')
    }
  }, [navigate])

  useEffect(() => {
    if (!schedule && !isLoading) {
      addToast(error ?? '일정을 불러오지 못했습니다.', 'error')
      handleClose()
    }
  }, [schedule, isLoading, addToast, handleClose, error])

  const handleSubmit = async (values: ScheduleFormValues) => {
    if (schedule?.recurrence) {
      const scope = await recurrenceScope.ask('edit', schedule.title)
      if (scope === null) return
      if (scope !== 'THIS') {
        await updateSeries(values, scope)
        return
      }
    }
    try {
      const plannedDuration = parseDurationInput(values.plannedDurationMinutes ?? '')
      const payload = {
        title: values.title,
        description: values.description,
        date: toApiDateTimeWithZone(values.date),
        scheduleType: values.scheduleType,
        // 바꾸지 않았거나 비워 두면 보내지 않는다: 서버가 기존 계획 길이를 유지한다.
        // (값이 저장되지 않은 예전 일정이 수정만으로 대체값을 저장하지 않게 한다.)
        ...(plannedDuration.kind === 'value' &&
        plannedDuration.minutes !== parseIsoDurationMinutes(schedule?.plannedDuration)
          ? { plannedDuration: minutesToIsoDuration(plannedDuration.minutes) }
          : {}),
      }
      const result: ScheduleResponse | null = await updateSchedule(Number(scheduleId), payload)
      if (result) {
        dispatchScheduleChanged({ schedule: result, reason: 'updated' })
      }
      handleClose()
    } catch (error) {
      console.error('일정 수정 실패:', error)
      addToast('일정 수정에 실패했습니다.', 'error')
      throw error
    }
  }

  /** ADR-0019 "이번 및 이후"·"전체": 바꾼 값만 시리즈에 보낸다. 날짜 이동은 "이번만"에서만 된다. */
  const updateSeries = async (values: ScheduleFormValues, scope: 'FOLLOWING' | 'ALL') => {
    if (!schedule?.recurrence) return
    if (toDateKey(values.date) !== toDateKey(schedule.date)) {
      addToast('날짜를 옮기는 것은 "이번만"으로 해 주세요. 반복 요일은 반복 관리에서 바꿔요.', 'error')
      return
    }
    const before = {
      title: schedule.title,
      description: schedule.description,
      startTime: toDisplayDayjs(schedule.date).format('HH:mm'),
      plannedDurationMinutes: parseIsoDurationMinutes(schedule.plannedDuration),
      scheduleType: schedule.scheduleType ?? 'DEEP_WORK',
    }
    const plannedDuration = parseDurationInput(values.plannedDurationMinutes ?? '')
    const after = {
      title: values.title,
      description: values.description,
      startTime: toDisplayDayjs(values.date).format('HH:mm'),
      plannedDurationMinutes: plannedDuration.kind === 'value' ? plannedDuration.minutes : before.plannedDurationMinutes,
      scheduleType: values.scheduleType,
    }
    try {
      const outcome = await confirmAndUpdateSeries(schedule.recurrence, scope, fixedChanges(before, after))
      if (outcome === 'cancelled') return
      if (outcome === 'updated') {
        dispatchScheduleChanged({ reason: 'recurrence' })
        addToast('반복 일정을 바꿨어요.', 'success')
      }
      handleClose()
    } catch (error) {
      console.error('반복 일정 수정 실패:', error)
      addToast('반복 일정을 바꾸지 못했어요.', 'error')
      throw error
    }
  }

  const initialValues: Partial<ScheduleFormValues> | undefined = useMemo(
    () => {
      void offsetMinutes
      return schedule
        ? {
            title: schedule.title,
            description: schedule.description,
            date: toDateFromApi(schedule.date),
            scheduleType: schedule.scheduleType ?? 'DEEP_WORK',
            plannedDurationMinutes: (() => {
              const minutes = parseIsoDurationMinutes(schedule.plannedDuration)
              return minutes ? String(minutes) : ''
            })(),
          }
          : undefined
    },
    [offsetMinutes, schedule],
  )

  if (!scheduleId) {
    return (
      <section className="schedule-form-page">
        <p className="schedule-form-page__status">유효하지 않은 일정 ID입니다.</p>
        <button type="button" onClick={handleClose}>
          목록으로 돌아가기
        </button>
      </section>
    )
  }

  return (
    <section className="schedule-form-page">
      <header className="schedule-form-page__header">
        <p className="schedule-form-page__eyebrow">일정 수정</p>
        <h1 className="schedule-form-page__title">세부 정보 업데이트</h1>
        <p className="schedule-form-page__description">
          기존 일정을 업데이트하고 변경 사항을 저장하세요. 시작/마감 시간과 중요도·난이도 정보를 조정할
          수 있습니다.
        </p>
      </header>
      {isLoading || !schedule ? (
        <p className="schedule-form-page__status">일정을 불러오는 중...</p>
      ) : (
        <ScheduleForm
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitLabel="일정 수정"
          plannedDurationHint="비워 두면 지금 계획 길이를 그대로 둬요."
        />
      )}
      {recurrenceScope.dialog}
    </section>
  )
}

export default ScheduleEditPage
