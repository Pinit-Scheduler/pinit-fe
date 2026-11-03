import { useLocation } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useRouteSurfaceNavigation } from '@shared/routing/RouteSurface'
import {
  assignScheduleCategory,
  assignSeriesCategory,
  CategoryPicker,
} from '@features/categories'
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

type LocationState = {
  initialDateKey?: string
}

const ScheduleCreatePage = () => {
  const { complete } = useRouteSurfaceNavigation()
  const [pendingCategory, setPendingCategory] = useState<{
    kind: 'schedule' | 'series'
    id: number
    categoryId: number | null
  } | null>(null)
  const [savingCategory, setSavingCategory] = useState(false)
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const location = useLocation()
  const { addToast } = useToast()
  const { offsetMinutes } = useTimePreferences()
  const { initialDateKey } = (location.state as LocationState | null) ?? {}

  const initialValues = useMemo(() => {
    void offsetMinutes
    if (!initialDateKey) return undefined
    const now = getTodayWithOffset()
    const targetDate = toDisplayDayjs(initialDateKey)
    if (!targetDate.isValid()) return undefined
    const start = targetDate.hour(now.hour()).minute(0).second(0)
    return {
      date: start.toDate(),
    }
  }, [initialDateKey, offsetMinutes])

  const handleClose = () => complete('/app/schedules')
  const finishCategory = async (
    pending: NonNullable<typeof pendingCategory>,
  ) => {
    setSavingCategory(true)
    setCategoryError(null)
    try {
      if (pending.kind === 'series')
        await assignSeriesCategory(pending.id, pending.categoryId, 'ALL')
      else await assignScheduleCategory(pending.id, pending.categoryId)
      handleClose()
    } catch (error) {
      setCategoryError(
        error instanceof Error
          ? error.message
          : '카테고리를 저장하지 못했어요. 다시 시도해 주세요.',
      )
    } finally {
      setSavingCategory(false)
    }
  }

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
      const payload = {
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
        const pending = {
          kind: 'schedule' as const,
          id: result.id,
          categoryId: values.categoryId ?? null,
        }
        setPendingCategory(pending)
        await finishCategory(pending)
      }
    } catch (error) {
      console.error('일정 저장 실패:', error)
      addToast('일정 저장에 실패했습니다.', 'error')
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
      if (!created.id) throw new Error('반복 일정 ID를 확인하지 못했어요.')
      dispatchScheduleChanged({ reason: 'recurrence' })
      addToast('반복 일정을 만들었어요.', 'success')
      const pending = {
        kind: 'series' as const,
        id: created.id,
        categoryId: values.categoryId ?? null,
      }
      setPendingCategory(pending)
      await finishCategory(pending)
    } catch (error) {
      console.error('반복 일정 저장 실패:', error)
      const fieldErrors =
        error instanceof ApiError && error.status === 400
          ? Object.values(mapRecurrenceServerErrors(error.data))
          : []
      addToast(
        fieldErrors[0] ??
          (error instanceof ApiError && error.status === 409
            ? '진행 중인 반복이 너무 많아요.'
            : '반복 일정을 만들지 못했어요.'),
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
      {pendingCategory ? (
        <div className="schedule-form">
          <p role="status">
            일정은 저장되었어요. 카테고리 저장을 마치면 닫힙니다.
          </p>
          <CategoryPicker
            value={pendingCategory.categoryId}
            disabled={savingCategory}
            onChange={(categoryId) =>
              setPendingCategory({ ...pendingCategory, categoryId })
            }
          />
          {categoryError && <p role="alert">{categoryError}</p>}
          <button
            type="button"
            className="schedule-form__submit"
            disabled={savingCategory}
            onClick={() => void finishCategory(pendingCategory)}
          >
            카테고리 저장 후 닫기
          </button>
        </div>
      ) : (
        <ScheduleForm
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitLabel="일정 추가"
          plannedDurationHint="비워 두면 30분으로 저장돼요."
          allowRecurrence
        />
      )}
    </section>
  )
}

export default ScheduleCreatePage
