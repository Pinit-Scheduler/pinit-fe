import { taskDots } from '../hub'
import type { TaskStateCounts } from '../types'

/** 작업 하나를 점 하나로. 읽기용 이름은 감싼 요소가 준다. */
export default function TaskDots({ counts }: { counts: TaskStateCounts }) {
  const view = taskDots(counts)
  if (view.kind === 'bar')
    return (
      <span className="hub-bar" aria-hidden>
        {view.segments.map((segment) => (
          <i
            key={segment.state}
            className={`is-${segment.state}`}
            style={{ flex: segment.count }}
          />
        ))}
      </span>
    )
  return (
    <span className="hub-dots" aria-hidden>
      {view.dots.map((dot, index) => (
        <i key={index} className={`is-${dot}`} />
      ))}
    </span>
  )
}
