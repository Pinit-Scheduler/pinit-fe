import { FIBONACCI_DIFFICULTIES } from '@constants/difficulty'
import type { TaskTag } from '../types/task'
import {
  DEADLINE_OPTIONS,
  DEFAULT_FILTERS,
  STATUS_OPTIONS,
  type TaskFilters,
} from '../utils/taskSearch'

type TaskFilterPanelProps = {
  filters: TaskFilters
  tags: TaskTag[]
  onChange: (next: TaskFilters) => void
  onManageTags: () => void
}

/** 작업 탭 필터(ADR-0023 §4): 상태, 마감, 중요도 최소, 난이도 최대, 태그. */
const TaskFilterPanel = ({ filters, tags, onChange, onManageTags }: TaskFilterPanelProps) => {
  const set = (patch: Partial<TaskFilters>) => onChange({ ...filters, ...patch })

  return (
    <div className="task-filter" role="region" aria-label="작업 필터">
      <div className="task-filter__group">
        <span className="task-filter__label">상태</span>
        <div className="task-filter__chips">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={['tag-chip', filters.status === option.value ? 'is-active' : ''].filter(Boolean).join(' ')}
              aria-pressed={filters.status === option.value}
              onClick={() => set({ status: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="task-filter__group">
        <span className="task-filter__label">마감</span>
        <div className="task-filter__chips">
          {DEADLINE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={['tag-chip', filters.deadline === option.value ? 'is-active' : ''].filter(Boolean).join(' ')}
              aria-pressed={filters.deadline === option.value}
              onClick={() => set({ deadline: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
        {filters.deadline === 'CUSTOM' && (
          <div className="task-filter__dates">
            <input type="date" value={filters.deadlineFrom} onChange={(e) => set({ deadlineFrom: e.target.value })} aria-label="마감 시작 날짜" />
            <span>~</span>
            <input type="date" value={filters.deadlineTo} onChange={(e) => set({ deadlineTo: e.target.value })} aria-label="마감 끝 날짜" />
          </div>
        )}
      </div>

      <div className="task-filter__row">
        <label className="task-filter__group">
          <span className="task-filter__label">중요도</span>
          <select
            value={filters.importanceMin ?? 1}
            onChange={(e) => set({ importanceMin: Number(e.target.value) > 1 ? Number(e.target.value) : null })}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((value) => (
              <option key={value} value={value}>
                {value === 1 ? '전체' : `${value} 이상`}
              </option>
            ))}
          </select>
        </label>
        <label className="task-filter__group">
          <span className="task-filter__label">난이도</span>
          <select
            value={filters.difficultyMax ?? 21}
            onChange={(e) => set({ difficultyMax: Number(e.target.value) < 21 ? Number(e.target.value) : null })}
          >
            {[...FIBONACCI_DIFFICULTIES].reverse().map((value) => (
              <option key={value} value={value}>
                {value === 21 ? '전체' : `${value} 이하`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="task-filter__group">
        <div className="task-filter__label-row">
          <span className="task-filter__label">태그 (하나라도 붙은 작업)</span>
          <button type="button" className="task-filter__link" onClick={onManageTags}>
            태그 관리
          </button>
        </div>
        {tags.length === 0 ? (
          <p className="task-filter__empty">아직 태그가 없어요. 작업 폼에서 만들 수 있어요.</p>
        ) : (
          <div className="task-filter__chips">
            {tags.map((tag) => {
              const active = filters.tagIds.includes(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  className={['tag-chip', active ? 'is-active' : ''].filter(Boolean).join(' ')}
                  aria-pressed={active}
                  onClick={() =>
                    set({ tagIds: active ? filters.tagIds.filter((id) => id !== tag.id) : [...filters.tagIds, tag.id] })
                  }
                >
                  #{tag.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="task-filter__footer">
        <button type="button" className="task-filter__link" onClick={() => onChange({ ...DEFAULT_FILTERS, query: filters.query, sort: filters.sort })}>
          필터 초기화
        </button>
      </div>
    </div>
  )
}

export default TaskFilterPanel
