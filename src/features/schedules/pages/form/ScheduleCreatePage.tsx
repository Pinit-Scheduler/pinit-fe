import { useLocation } from 'react-router-dom'
import { useMemo } from 'react'
import { useRouteSurfaceNavigation } from '@shared/routing/RouteSurface'
import ScheduleForm from '../../components/ScheduleForm'
import {
  getDisplayZoneId,
  getTodayWithOffset,
  toApiDateTimeWithZone,
  toDisplayDayjs,
} from '@shared/utils/datetime'
import type { ScheduleFormValues, ScheduleResponse } from '../../types/schedule'
import { createSchedule } from '../../api/schedules'
import { useToast } from '@contexts/ToastContext'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { dispatchScheduleChanged } from '@shared/utils/events'
import {
  minutesToIsoDuration,
  parseDurationInput,
} from '@shared/utils/isoDuration'
import './ScheduleFormPage.css'
import { createRecurrence } from '@features/recurrence/api/recurrences'
import {
  mapRecurrenceServerErrors,
  toRule,
  type RuleDraft,
} from '@features/recurrence/utils/recurrenceRules'
import { ApiError } from '@shared/api/httpClient'
import { getRequestFailureMessage } from '@shared/api/errorMessage'
import { parseDateKey } from '@shared/utils/dateKey'

type LocationState = {
  initialDateKey?: string
}

const ScheduleCreatePage = () => {
  const { complete } = useRouteSurfaceNavigation()
  const location = useLocation()
  const { addToast } = useToast()
  const { offsetMinutes } = useTimePreferences()
  // 열어 준 화면이 state로 날짜를 주거나, 핀잇 앱처럼 주소로만 열 때는 ?date=YYYY-MM-DD로 준다.
  const dateParam = new URLSearchParams(location.search).get('date')
  const initialDateKey =
    (location.state as LocationState | null)?.initialDateKey ??
    (dateParam && parseDateKey(dateParam) ? dateParam : undefined)

  const initialValues = useMemo(() => {
    void offsetMinutes
    const date = (() => {
      if (!initialDateKey) return undefined
      const now = getTodayWithOffset()
      const targetDate = toDisplayDayjs(initialDateKey)
      if (!targetDate.isValid()) return undefined
      return targetDate.hour(now.hour()).minute(0).second(0).toDate()
    })()
    return date === undefined ? undefined : { date }
  }, [initialDateKey, offsetMinutes])

  const handleClose = () => complete('/app/schedules')
  const handleSubmit = async (
    values: ScheduleFormValues,
    rule?: RuleDraft | null,
  ) => {
    if (rule) {
      await createRecurringSchedule(values, rule)
      return
    }
    try {
      const plannedDuration = parseDurationInput(
        values.plannedDurationMinutes ?? '',
      )
      // 일정은 개인 것이고 어느 스페이스에도 속하지 않는다. 스페이스·프로젝트·담당자를 보내지 않는다.
      // 서버는 위치 없는 일정을 만든 사람의 것으로 둔다.
      const payload = {
        expectedVersion: values.expectedVersion,
        title: values.title,
        description: values.description,
        date: toApiDateTimeWithZone(values.date),
        scheduleType: values.scheduleType,
        // 비워 두면 보내지 않는다: 서버가 30분을 저장한다.
        ...(plannedDuration.kind === 'value'
          ? { plannedDuration: minutesToIsoDuration(plannedDuration.minutes) }
          : {}),
      }
      const result: ScheduleResponse | null = await createSchedule(payload)
      if (result) {
        dispatchScheduleChanged({ schedule: result, reason: 'created' })
        handleClose()
      }
    } catch (error) {
      console.error('일정 저장 실패:', error)
      addToast(
        getRequestFailureMessage(
          error,
          '일정을 저장하지 못했어요.',
        ),
        'error',
      )
      throw error
    }
  }

  /** ADR-0019 FIXED 반복: 회차마다 작업 없는 일정을 같은 시각에 만든다. */
  const createRecurringSchedule = async (
    values: ScheduleFormValues,
    rule: RuleDraft,
  ) => {
    const plannedDuration = parseDurationInput(
      values.plannedDurationMinutes ?? '',
    )
    try {
      // 반복 일정(FIXED)도 같다. createRecurrence가 FIXED에는 위치와 담당자를 싣지 않는다.
      const payload = {
        mode: 'FIXED' as const,
        title: values.title,
        description: values.description,
        fixed: {
          startTime: toDisplayDayjs(values.date).format('HH:mm'),
          plannedDuration: minutesToIsoDuration(
            plannedDuration.kind === 'value' ? plannedDuration.minutes : 30,
          ),
          scheduleType: values.scheduleType,
        },
        rule: toRule(rule),
        zoneId: getDisplayZoneId(),
      }
      const created = await createRecurrence(payload)
      dispatchScheduleChanged({ reason: 'recurrence' })
      // 응답에 시리즈 ID가 없어도 서버는 만들었다. 다시 만들지 않도록 화면을 닫고 확인할 곳만 알린다.
      if (!created.id)
        addToast(
          '반복 일정을 만들었어요. 나의 스페이스 전체를 고른 뒤 설정 → 반복 관리에서 확인해 주세요.',
          'info',
        )
      else addToast('반복 일정을 만들었어요.', 'success')
      handleClose()
    } catch (error) {
      console.error('반복 일정 저장 실패:', error)
      const fieldErrors =
        error instanceof ApiError && error.status === 400
          ? Object.values(mapRecurrenceServerErrors(error.data))
          : []
      addToast(
        fieldErrors[0] ??
          getRequestFailureMessage(
            error,
            '반복 일정을 만들지 못했어요.',
          ),
        'error',
      )
      throw error
    }
  }

  return (
    <section className="schedule-form-page">
      <header className="schedule-form-page__header">
        <p className="schedule-form-page__eyebrow">새 일정</p>
        <h1 className="schedule-form-page__title">일정 추가</h1>
        <p className="schedule-form-page__description">
          제목, 설명, 시간 정보를 입력하면 일정 탭에 바로 반영돼요. 필요한 경우
          중요도와 난이도를 함께 설정해 보세요.
        </p>
      </header>
      <ScheduleForm
        initialValues={initialValues}
        onSubmit={handleSubmit}
        submitLabel="일정 생성"
        plannedDurationHint="비워 두면 서버 기본 계획 길이가 적용돼요."
        allowRecurrence
      />
    </section>
  )
}

export default ScheduleCreatePage
