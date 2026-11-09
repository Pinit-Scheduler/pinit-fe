import {
  useMoveConfirmation,
  moveResultMessage,
} from '@features/spaces/useMoveConfirmation'
import EditConflictDialog from '@features/spaces/EditConflictDialog'
import MyInputDisclosure from '@features/spaces/MyInputDisclosure'
import { changedInput, isEditConflict } from '@features/spaces/conflicts'
import type { InputRow } from '@features/spaces/conflicts'
import { scheduleTypeLabel } from '@constants/schedules'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import ScheduleForm from '../../components/ScheduleForm'
import { toApiDateTimeWithZone, toDateFromApi } from '@shared/utils/datetime'
import type { ScheduleFormValues, ScheduleResponse } from '../../types/schedule'
import useScheduleDetail from '../../hooks/useScheduleDetail'
import { useToast } from '@contexts/ToastContext'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import './ScheduleFormPage.css'
import { updateSchedule } from '../../api/schedules'
import { dispatchScheduleChanged } from '@shared/utils/events'
import {
  minutesToIsoDuration,
  parseDurationInput,
  parseIsoDurationMinutes,
} from '@shared/utils/isoDuration'
import { toDateKey, toDisplayDayjs } from '@shared/utils/datetime'
import { useRecurrenceScope } from '@features/recurrence/components/RecurrenceScopeDialog'
import {
  confirmAndUpdateSeries,
  previewSeriesUpdate,
} from '@features/recurrence/utils/seriesMutations'
import { fixedChanges } from '@features/recurrence/utils/recurrenceRules'

import { useRouteSurfaceNavigation } from '@shared/routing/RouteSurface'
import { useCategories } from '@features/categories'

const LABELS = {
  title: '제목',
  description: '설명',
  date: '날짜·시간',
  scheduleType: '유형',
  plannedDurationMinutes: '계획 시간(분)',
}

const ScheduleEditPage = () => {
  const { scheduleId } = useParams()
  const { complete } = useRouteSurfaceNavigation()
  const {
    scheduleCategory,
    isLoading: categoryLoading,
    hasLoaded: categoryLoaded,
    error: categoryLoadError,
    reload: reloadCategories,
  } = useCategories()
  const { addToast } = useToast()
  // Keep the edit session's original snapshot; background events must not remount the draft.
  const { schedule, isLoading, error, refetch } = useScheduleDetail(scheduleId, {
    refreshOnChange: false,
  })
  const { offsetMinutes } = useTimePreferences()
  const recurrenceScope = useRecurrenceScope()
  const move = useMoveConfirmation()
  const [conflict, setConflict] = useState<{ rows: InputRow[] } | null>(null)
  const [keptInput, setKeptInput] = useState<InputRow[] | null>(null)
  const reportConflict = (values: ScheduleFormValues) => {
    if (!schedule) return
    const show = (type: string) =>
      scheduleTypeLabel[type as keyof typeof scheduleTypeLabel] ?? type
    const server = {
      title: schedule.title,
      description: schedule.description,
      date: toDisplayDayjs(schedule.date).format('YYYY-MM-DD HH:mm'),
      scheduleType: show(schedule.scheduleType ?? 'DEEP_WORK'),
      plannedDurationMinutes:
        parseIsoDurationMinutes(schedule.plannedDuration) ?? '',
    }
    const mine = {
      title: values.title,
      description: values.description,
      date: toDisplayDayjs(values.date).format('YYYY-MM-DD HH:mm'),
      scheduleType: show(values.scheduleType),
      plannedDurationMinutes: values.plannedDurationMinutes ?? '',
    }
    // 이전 충돌 상태는 이번 시도의 입력으로 바꾼다.
    setConflict({ rows: changedInput(server, mine, LABELS) })
  }
  const loadLatest = () => {
    setKeptInput(conflict?.rows ?? null)
    setConflict(null)
    refetch()
  }
  const affiliation = (values: ScheduleFormValues) => {
    const location = values.locationChanged || values.categoryChanged
    if (!location && !values.assigneeChanged) return undefined
    return {
      ...(location
        ? { spaceId: values.spaceId, projectId: values.categoryId ?? null }
        : {}),
      ...(values.assigneeChanged && values.assigneeId !== undefined
        ? { assigneeId: values.assigneeId }
        : {}),
    }
  }
  const seriesRef = (values: ScheduleFormValues) => ({
    ...schedule!.recurrence!,
    version: values.recurrenceVersion ?? schedule!.recurrence!.version,
  })

  const handleClose = useCallback(() => complete('/app/schedules'), [complete])
  const categoryId = schedule
    ? (schedule.projectId ?? scheduleCategory(schedule.id)?.id ?? null)
    : null

  useEffect(() => {
    if (!schedule && !isLoading) {
      addToast(error ?? '일정을 불러오지 못했습니다.', 'error')
      handleClose()
    }
  }, [schedule, isLoading, addToast, handleClose, error])

  const handleSubmit = async (values: ScheduleFormValues) => {
    if (
      (values.locationChanged || values.categoryChanged) &&
      !(await move.confirm(schedule?.spaceId, values.spaceId))
    )
      return false
    if (schedule?.recurrence) {
      const scope = await recurrenceScope.ask('edit', schedule.title, {
        preview: async (selected) => {
          if (selected === 'THIS') return '이번 회차만 저장해요.'
          if (toDateKey(values.date) !== toDateKey(schedule.date))
            throw new Error(
              '날짜 이동은 이번 회차만 선택해 주세요. 반복 요일은 반복 관리에서 바꿀 수 있어요.',
            )
          const message = await previewSeriesUpdate(
            seriesRef(values),
            selected,
            seriesChanges(values),
            affiliation(values),
          )
          return message
        },
      })
      if (scope === null) return false
      if (scope !== 'THIS') {
        return updateSeries(values, scope)
      }
    }
    try {
      const plannedDuration = parseDurationInput(
        values.plannedDurationMinutes ?? '',
      )
      const payload = {
        ...affiliation(values),
        expectedVersion: values.expectedVersion,
        title: values.title,
        description: values.description,
        date: toApiDateTimeWithZone(values.date),
        scheduleType: values.scheduleType,
        // 바꾸지 않았거나 비워 두면 보내지 않는다: 서버가 기존 계획 길이를 유지한다.
        // (값이 저장되지 않은 예전 일정이 수정만으로 대체값을 저장하지 않게 한다.)
        ...(plannedDuration.kind === 'value' &&
        plannedDuration.minutes !==
          parseIsoDurationMinutes(schedule?.plannedDuration)
          ? { plannedDuration: minutesToIsoDuration(plannedDuration.minutes) }
          : {}),
      }
      const result: ScheduleResponse | null = await updateSchedule(
        Number(scheduleId),
        payload,
      )
      if (result) {
        const moveMessage = moveResultMessage(result.moveResult)
        if (moveMessage) addToast(moveMessage, 'success')
        dispatchScheduleChanged({
          schedule: result,
          previousDateKey: schedule ? toDateKey(schedule.date) : undefined,
          reason: 'updated',
        })
      }
      setKeptInput(null)
      handleClose()
    } catch (error) {
      console.error('일정 수정 실패:', error)
      if (isEditConflict(error)) {
        reportConflict(values)
        return false
      }
      addToast(
        error instanceof Error
          ? error.message
          : '일정 수정에 실패했습니다. 입력한 내용은 유지됩니다.',
        'error',
      )
      throw error
    }
  }

  const seriesChanges = (values: ScheduleFormValues) => {
    if (!schedule) return {}
    const before = {
      title: schedule.title,
      description: schedule.description,
      startTime: toDisplayDayjs(schedule.date).format('HH:mm'),
      plannedDurationMinutes: parseIsoDurationMinutes(schedule.plannedDuration),
      scheduleType: schedule.scheduleType ?? 'DEEP_WORK',
    }
    const plannedDuration = parseDurationInput(
      values.plannedDurationMinutes ?? '',
    )
    const after = {
      title: values.title,
      description: values.description,
      startTime: toDisplayDayjs(values.date).format('HH:mm'),
      plannedDurationMinutes:
        plannedDuration.kind === 'value'
          ? plannedDuration.minutes
          : before.plannedDurationMinutes,
      scheduleType: values.scheduleType,
    }
    return fixedChanges(before, after)
  }

  /** ADR-0019 "이번 및 이후"·"전체": 바꾼 값만 시리즈에 보낸다. 날짜 이동은 "이번만"에서만 된다. */
  const updateSeries = async (
    values: ScheduleFormValues,
    scope: 'FOLLOWING' | 'ALL',
  ) => {
    if (!schedule?.recurrence) return
    if (toDateKey(values.date) !== toDateKey(schedule.date)) {
      addToast(
        '날짜를 옮기는 것은 "이번만"으로 해 주세요. 반복 요일은 반복 관리에서 바꿔요.',
        'error',
      )
      return false
    }
    try {
      const outcome = await confirmAndUpdateSeries(
        seriesRef(values),
        scope,
        seriesChanges(values),
        true,
        affiliation(values),
      )
      if (outcome === 'cancelled') return false
      if (outcome === 'updated') {
        dispatchScheduleChanged({ reason: 'recurrence' })
        addToast('반복 일정을 바꿨어요.', 'success')
      }
      setKeptInput(null)
      handleClose()
    } catch (error) {
      console.error('반복 일정 수정 실패:', error)
      if (isEditConflict(error)) {
        reportConflict(values)
        return false
      }
      addToast(
        error instanceof Error
          ? error.message
          : '반복 일정 저장에 실패했습니다. 입력한 내용은 유지됩니다.',
        'error',
      )
      throw error
    }
  }

  const initialValues: Partial<ScheduleFormValues> | undefined = useMemo(() => {
    void offsetMinutes
    return schedule
      ? {
          spaceId: schedule.spaceId,
          assigneeId: schedule.assigneeId,
          expectedVersion: schedule.version,
          recurrenceVersion: schedule.recurrence?.version,
          title: schedule.title,
          description: schedule.description,
          date: toDateFromApi(schedule.date),
          scheduleType: schedule.scheduleType ?? 'DEEP_WORK',
          categoryId,
          plannedDurationMinutes: (() => {
            const minutes = parseIsoDurationMinutes(schedule.plannedDuration)
            return minutes ? String(minutes) : ''
          })(),
        }
      : undefined
  }, [offsetMinutes, schedule, categoryId])

  if (!scheduleId) {
    return (
      <section className="schedule-form-page">
        <p className="schedule-form-page__status">
          유효하지 않은 일정 ID입니다.
        </p>
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
          기존 일정을 업데이트하고 변경 사항을 저장하세요. 시작/마감 시간과
          중요도·난이도 정보를 조정할 수 있습니다.
        </p>
      </header>
      {isLoading || (categoryLoading && !categoryLoaded) || !schedule ? (
        <p className="schedule-form-page__status">일정을 불러오는 중...</p>
      ) : categoryLoadError && !categoryLoaded ? (
        <div className="schedule-form-page__status" role="alert">
          <p>
            프로젝트를 불러오지 못했어요. 기존 분류를 확인한 뒤 수정할 수
            있어요.
          </p>
          <p>{categoryLoadError}</p>
          <button
            type="button"
            onClick={() => void reloadCategories().catch(() => {})}
          >
            다시 시도
          </button>
        </div>
      ) : (
        <>
          {categoryLoadError && (
            <div role="alert">
              <p>
                프로젝트를 새로 확인하지 못했어요. 작성 중인 내용은 유지됩니다.
              </p>
              <button
                type="button"
                onClick={() => void reloadCategories().catch(() => {})}
              >
                프로젝트 다시 확인
              </button>
            </div>
          )}
          {keptInput && <MyInputDisclosure rows={keptInput} open={false} />}
          <ScheduleForm
            allowedActions={schedule?.allowedActions}
            unavailableReasons={schedule?.unavailableReasons}
            key={schedule.id}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitLabel="일정 수정"
            plannedDurationHint="비워 두면 지금 계획 길이를 그대로 둬요."
          />
        </>
      )}
      {recurrenceScope.dialog}
      {move.dialog}
      {conflict && (
        <EditConflictDialog
          noun="일정"
          rows={conflict.rows}
          onLoadLatest={loadLatest}
        />
      )}
    </section>
  )
}

export default ScheduleEditPage
