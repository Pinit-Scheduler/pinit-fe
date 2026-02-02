import { useLocation, useNavigate } from 'react-router-dom'
import { useMemo } from 'react'
import ScheduleForm from '../../components/ScheduleForm'
import { getTodayWithOffset, toApiDateTimeWithZone, toDisplayDayjs } from '@shared/utils/datetime'
import type { ScheduleFormValues, ScheduleResponse } from '../../types/schedule'
import { createSchedule } from '../../api/schedules'
import { useToast } from '@contexts/ToastContext'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { dispatchScheduleChanged } from '@shared/utils/events'
import './ScheduleFormPage.css'

type LocationState = {
  initialDateKey?: string
}

const ScheduleCreatePage = () => {
  const navigate = useNavigate()
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

  const handleClose = () => {
    if (window.history.state && window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/app/schedules')
    }
  }

  const handleSubmit = async (values: ScheduleFormValues) => {
    try {
      const payload = {
        title: values.title,
        description: values.description,
        date: toApiDateTimeWithZone(values.date),
        scheduleType: values.scheduleType,
      }
      const result: ScheduleResponse | null = await createSchedule(payload)
      if (result) {
        dispatchScheduleChanged({ schedule: result, reason: 'created' })
      }
      handleClose()
    } catch (error) {
      console.error('일정 저장 실패:', error)
      addToast('일정 저장에 실패했습니다.', 'error')
      throw error
    }
  }

  return (
    <section className="schedule-form-page">
      <header className="schedule-form-page__header">
        <p className="schedule-form-page__eyebrow">새 일정</p>
        <h1 className="schedule-form-page__title">일정 추가</h1>
        <p className="schedule-form-page__description">
          제목, 설명, 시간 정보를 입력하면 일정 탭에 바로 반영돼요. 필요한 경우 중요도와 난이도를 함께
          설정해 보세요.
        </p>
      </header>
      <ScheduleForm initialValues={initialValues} onSubmit={handleSubmit} submitLabel="일정 추가" />
    </section>
  )
}

export default ScheduleCreatePage
