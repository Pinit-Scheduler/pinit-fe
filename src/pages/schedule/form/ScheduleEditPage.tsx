import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ScheduleForm from '../../../components/schedules/ScheduleForm'
import { updateSchedule } from '../../../api/schedules'
import { toApiDateTimeWithZone, toDateFromApi } from '../../../utils/datetime'
import type { ScheduleFormValues, ScheduleResponse } from '../../../types/schedule'
import useScheduleDetail from '../../../hooks/useScheduleDetail'
import { useToast } from '../../../context/ToastContext'
import { useTimePreferences } from '../../../context/TimePreferencesContext'
import './ScheduleFormPage.css'

const ScheduleEditPage = () => {
  const { scheduleId } = useParams()
  const navigate = useNavigate()
  const { addToast } = useToast()
  const { schedule, isLoading, error } = useScheduleDetail(scheduleId)
  const { offsetMinutes } = useTimePreferences()

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
    try {
      const payload = {
        title: values.title,
        description: values.description,
        importance: values.importance,
        urgency: values.urgency,
        taskType: values.taskType,
        date: toApiDateTimeWithZone(values.date),
        deadline: toApiDateTimeWithZone(values.deadline),
      }
      const result: ScheduleResponse | null = await updateSchedule(Number(scheduleId), payload)
      if (result) {
        window.dispatchEvent(
          new CustomEvent('schedule:changed', {
            detail: { schedule: result, type: 'edit' },
          }),
        )
      }
      handleClose()
    } catch (error) {
      console.error('일정 수정 실패:', error)
      addToast('일정 수정에 실패했습니다.', 'error')
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
            deadline: toDateFromApi(schedule.deadline),
            importance: schedule.importance,
            urgency: schedule.urgency,
            // taskType은 백엔드에서 제공하지 않으므로 기본값 사용
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
          기존 일정을 업데이트하고 변경 사항을 저장하세요. 시작/마감 시간과 중요도·긴급도 정보를 조정할
          수 있습니다.
        </p>
      </header>
      {isLoading || !schedule ? (
        <p className="schedule-form-page__status">일정을 불러오는 중...</p>
      ) : (
        <ScheduleForm initialValues={initialValues} onSubmit={handleSubmit} submitLabel="일정 수정" />
      )}
    </section>
  )
}

export default ScheduleEditPage
