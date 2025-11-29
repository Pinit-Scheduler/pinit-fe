import { useEffect } from 'react'
import ScheduleForm from '../schedules/ScheduleForm'
import { createSchedule, updateSchedule } from '../../api/schedules'
import { toApiDateTimeKST } from '../../utils/datetime'
import type { ScheduleFormValues, ScheduleResponse } from '../../types/schedule'
import './ScheduleModal.css'

type ScheduleModalProps = {
  mode: 'create' | 'edit'
  schedule?: ScheduleResponse | null
  onClose: () => void
}

const ScheduleModal = ({ mode, schedule, onClose }: ScheduleModalProps) => {
  useEffect(() => {
    return () => {
      // ensure cleanup closes modal state via onClose if unmounted externally
    }
  }, [])

  const handleSubmit = async (values: ScheduleFormValues) => {
    try {
      if (mode === 'create') {
        await createSchedule({
          ...values,
          date: toApiDateTimeKST(values.date),
          deadline: toApiDateTimeKST(values.deadline),
        })
      } else if (schedule) {
        await updateSchedule(schedule.id, {
          ...values,
          date: toApiDateTimeKST(values.date),
          deadline: toApiDateTimeKST(values.deadline),
        })
      }
      onClose()
    } catch (error) {
      console.error('일정 저장 실패:', error)
      alert('일정 저장에 실패했습니다.')
      // 에러 발생 시에도 모달을 닫으려면 onClose() 호출
      // onClose()
    }
  }

  const initialValues: Partial<ScheduleFormValues> | undefined = schedule
    ? {
        title: schedule.title,
        description: schedule.description,
        date: new Date(schedule.date),
        deadline: new Date(schedule.deadline),
        importance: schedule.importance,
        urgency: schedule.urgency,
        // taskType은 백엔드에서 제공하지 않으므로 기본값 사용
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
