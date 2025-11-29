import { useState } from 'react'
import dayjs from 'dayjs'
import type { ScheduleFormValues } from '../types/schedule'

const buildDefaultDate = () => dayjs().tz('Asia/Seoul').minute(0).second(0)

const createInitialValues = (overrides?: Partial<ScheduleFormValues>): ScheduleFormValues => {
  const base = buildDefaultDate()
  const defaultValues: ScheduleFormValues = {
    title: '',
    description: '',
    date: base.toDate(),
    deadline: base.add(2, 'hour').toDate(),
    importance: 5,
    urgency: 5,
    taskType: 'DEEP_WORK',
    previousTaskIds: [],
    nextTaskIds: [],
  }
  return { ...defaultValues, ...overrides }
}

type UseScheduleFormOptions = {
  initialValues?: Partial<ScheduleFormValues>
}

type UseScheduleFormReturn = {
  values: ScheduleFormValues
  errors: Partial<Record<keyof ScheduleFormValues, string>>
  isSubmitting: boolean
  onChange: <K extends keyof ScheduleFormValues>(key: K, value: ScheduleFormValues[K]) => void
  validate: () => boolean
  setSubmitting: (value: boolean) => void
  reset: (nextValues?: Partial<ScheduleFormValues>) => void
}

const useScheduleForm = ({ initialValues }: UseScheduleFormOptions = {}): UseScheduleFormReturn => {
  const [values, setValues] = useState<ScheduleFormValues>(() => createInitialValues(initialValues))
  const [errors, setErrors] = useState<Partial<Record<keyof ScheduleFormValues, string>>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const validate = () => {
    const nextErrors: Partial<Record<keyof ScheduleFormValues, string>> = {}
    if (!values.title.trim()) nextErrors.title = '제목을 입력해 주세요.'
    if (!values.description.trim()) nextErrors.description = '설명을 입력해 주세요.'
    if (dayjs(values.deadline).isBefore(values.date)) {
      nextErrors.deadline = '마감일은 시작 시간 이후여야 합니다.'
    }
    if (values.importance < 1 || values.importance > 9) {
      nextErrors.importance = '중요도는 1~9 사이여야 합니다.'
    }
    if (values.urgency < 1 || values.urgency > 9) {
      nextErrors.urgency = '긴급도는 1~9 사이여야 합니다.'
    }
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const onChange = <K extends keyof ScheduleFormValues>(key: K, value: ScheduleFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const reset = (nextValues?: Partial<ScheduleFormValues>) => {
    setValues(createInitialValues(nextValues))
    setErrors({})
  }

  return {
    values,
    errors,
    isSubmitting,
    onChange,
    validate,
    setSubmitting: setIsSubmitting,
    reset,
  }
}

export default useScheduleForm
