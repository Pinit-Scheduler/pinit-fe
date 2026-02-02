import { useMemo, useState } from 'react'
import { getTodayWithOffset } from '@shared/utils/datetime'
import type { ScheduleFormValues } from '../types/schedule'
import { useTimePreferences } from '@contexts/TimePreferencesContext'

const buildDefaultDate = (offsetMinutes: number) => getTodayWithOffset(offsetMinutes).minute(0).second(0)

const createInitialValues = (offsetMinutes: number, overrides?: Partial<ScheduleFormValues>): ScheduleFormValues => {
  const base = buildDefaultDate(offsetMinutes)
  const defaultValues: ScheduleFormValues = {
    title: '',
    description: '',
    date: base.toDate(),
    scheduleType: 'DEEP_WORK',
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
  const { offsetMinutes } = useTimePreferences()
  const baseOffset = useMemo(() => Number.isFinite(offsetMinutes) ? offsetMinutes : 0, [offsetMinutes])
  const [values, setValues] = useState<ScheduleFormValues>(() => createInitialValues(baseOffset, initialValues))
  const [errors, setErrors] = useState<Partial<Record<keyof ScheduleFormValues, string>>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const validate = () => {
    const nextErrors: Partial<Record<keyof ScheduleFormValues, string>> = {}
    if (!values.title.trim()) nextErrors.title = '제목을 입력해 주세요.'
    if (!values.description.trim()) nextErrors.description = '설명을 입력해 주세요.'
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const onChange = <K extends keyof ScheduleFormValues>(key: K, value: ScheduleFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const reset = (nextValues?: Partial<ScheduleFormValues>) => {
    setValues(createInitialValues(baseOffset, nextValues))
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
