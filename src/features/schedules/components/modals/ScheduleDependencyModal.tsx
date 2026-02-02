import { useMemo, useState } from 'react'
import useScheduleList from '../../hooks/useScheduleList'
import { getTodayWithOffset, toDateKey, toDisplayDayjs } from '@shared/utils/datetime'
import type { ScheduleSummary } from '../../types/schedule'
import './ScheduleModal.css'
import './ScheduleDependencyModal.css'
import { useTimePreferences } from '@contexts/TimePreferencesContext'

type ScheduleDependencyModalProps = {
  isOpen: boolean
  mode: 'previous' | 'next'
  onClose: () => void
  selectedIds: number[]
  onApply: (schedules: ScheduleSummary[]) => void
}

const modeLabels: Record<'previous' | 'next', string> = {
  previous: '이전에 해야 하는 일정',
  next: '이후에 해야 하는 일정',
}

const ScheduleDependencyModal = ({
  isOpen,
  mode,
  onClose,
  selectedIds,
  onApply,
}: ScheduleDependencyModalProps) => {
  const { offsetMinutes } = useTimePreferences()
  const [selectedDateKey, setSelectedDateKey] = useState(() => toDateKey(getTodayWithOffset(offsetMinutes)))
  const selectedDate = useMemo(() => toDisplayDayjs(selectedDateKey), [selectedDateKey])
  const [localSelection, setLocalSelection] = useState<number[]>(selectedIds)
  const { schedules, isLoading, error, refetch } = useScheduleList(selectedDate)

  const dateLabel = useMemo(() => toDateKey(selectedDate), [selectedDate])

  const toggleSelection = (id: number) => {
    setLocalSelection((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  const handleApply = () => {
    const selected = schedules.filter((item) => localSelection.includes(item.id))
    onApply(selected)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="schedule-modal__backdrop">
      <div className="schedule-modal__content">
        <header className="schedule-modal__header">
          <div>
            <p className="dependency-modal__eyebrow">달력에서 선택</p>
            <h1>{modeLabels[mode]}</h1>
          </div>
          <button className="schedule-modal__close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>
        <div className="schedule-modal__body dependency-modal__body">
          <div className="dependency-modal__date-row">
            <button
              type="button"
              onClick={() =>
                setSelectedDateKey(selectedDate.subtract(1, 'day').format('YYYY-MM-DD'))
              }
            >
              이전 날
            </button>
            <input
              type="date"
              value={selectedDate.format('YYYY-MM-DD')}
              onChange={(event) =>
                setSelectedDateKey(event.target.value)
              }
            />
            <button
              type="button"
              onClick={() => setSelectedDateKey(selectedDate.add(1, 'day').format('YYYY-MM-DD'))}
            >
              다음 날
            </button>
          </div>

          <div className="dependency-modal__info">
            <span>{dateLabel} 일정</span>
            <button type="button" onClick={refetch}>
              새로고침
            </button>
          </div>

          {isLoading ? (
            <p className="dependency-modal__status">일정을 불러오는 중...</p>
          ) : error ? (
            <p className="dependency-modal__status dependency-modal__status--error">{error}</p>
          ) : schedules.length === 0 ? (
            <p className="dependency-modal__status">이 날짜에 등록된 일정이 없습니다.</p>
          ) : (
            <ul className="dependency-modal__list">
              {schedules.map((schedule) => {
                const isChecked = localSelection.includes(schedule.id)
                return (
                  <li key={schedule.id}>
                    <label className={isChecked ? 'is-checked' : ''}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelection(schedule.id)}
                      />
                      <div>
                        <strong>{schedule.title}</strong>
                        <small>
                          중요도 {schedule.importance} · 난이도 {schedule.difficulty}
                        </small>
                      </div>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <footer className="dependency-modal__footer">
          <button type="button" className="dependency-modal__ghost" onClick={onClose}>
            취소
          </button>
          <button type="button" className="dependency-modal__primary" onClick={handleApply} disabled={localSelection.length === 0}>
            선택 추가
          </button>
        </footer>
      </div>
    </div>
  )
}

export default ScheduleDependencyModal
