import { useEffect } from 'react'
import ScheduleForm from '../ScheduleForm'
import { createSchedule, updateSchedule } from '../../api/schedules'
import { toApiDateTimeWithZone, toDateFromApi } from '@shared/utils/datetime'
import type { ScheduleFormValues, ScheduleResponse } from '../../types/schedule'
import { useToast } from '@contexts/ToastContext'
import { dispatchScheduleChanged } from '@shared/utils/events'
import './ScheduleModal.css'

type ScheduleModalProps = {
  mode: 'create' | 'edit'
  schedule?: ScheduleResponse | null
  onClose: () => void
}

/**
 * 일정 생성/수정 모달 컴포넌트
 * @param mode - 'create' | 'edit'
 * @param schedule - 수정 모드일 때 편집할 일정 데이터
 * @param onClose - 모달 닫기 콜백
 * @constructor
 */
const ScheduleModal = ({ mode, schedule, onClose }: ScheduleModalProps) => {
  const { addToast } = useToast()

  useEffect(() => {
    return () => {
      // ensure cleanup closes modal state via onClose if unmounted externally
    }
  }, [])

  const handleSubmit = async (values: ScheduleFormValues) => {
    try {
      const payload = {
        title: values.title,
        description: values.description,
        date: toApiDateTimeWithZone(values.date),
        scheduleType: values.scheduleType,
      }
      let result: ScheduleResponse | null = null
      if (mode === 'create') {
        result = await createSchedule(payload)
      } else if (schedule) {
        result = await updateSchedule(schedule.id, payload)
      } else {
        throw new Error('수정할 일정이 없습니다.')
      }
      if (result) {
        dispatchScheduleChanged({ schedule: result, reason: mode === 'create' ? 'created' : 'updated' })
      }
      onClose()
    } catch (error) {
      console.error('일정 저장 실패:', error)
      addToast('일정 저장에 실패했습니다.', 'error')
      throw error
      // 에러 발생 시에도 모달을 닫으려면 onClose() 호출
      // onClose()
    }
  }

  const initialValues: Partial<ScheduleFormValues> | undefined = schedule
    ? {
        title: schedule.title,
        description: schedule.description,
        date: toDateFromApi(schedule.date),
        scheduleType: schedule.scheduleType ?? 'DEEP_WORK',
      }
    : undefined

  return (
    <div className="schedule-modal__backdrop" onClick={onClose}>
      <div className="schedule-modal__content" onClick={(e) => e.stopPropagation()}>
        <header className="schedule-modal__header">
          <h1>{mode === 'create' ? '일정 추가' : '일정 수정'}</h1>
          <button
            className="schedule-modal__close"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            type="button"
            aria-label="닫기"
          >
            ✕
          </button>
        </header>
        <div className="schedule-modal__body">
          <ScheduleForm
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitLabel={mode === 'create' ? '일정 추가' : '일정 수정'}
          />
        </div>
      </div>
    </div>
  )
}

export default ScheduleModal
