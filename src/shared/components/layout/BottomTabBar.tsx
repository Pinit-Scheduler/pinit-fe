import { NavLink, useNavigate } from 'react-router-dom'
import { useScheduleViewStateContext } from '@contexts/ScheduleViewStateContext'
import { toDateKey } from '@shared/utils/datetime'
import './BottomTabBar.css'

type BottomTabBarProps = {
  activePath: string
}

const tabs = [
  { key: 'today', label: '오늘', path: '/app/today', icon: '✨' },
  { key: 'schedules', label: '일정', path: '/app/schedules', icon: '📅' },
  { key: 'tasks', label: '작업', path: '/app/tasks', icon: '✅' },
  { key: 'statistics', label: '통계', path: '/app/statistics', icon: '📊' },
]

/**
 * 하단 네비게이션 바 컴포넌트
 * @param activePath - 현재 활성화된 경로
 * @constructor
 */
const BottomTabBar = ({ activePath }: BottomTabBarProps) => {
  const navigate = useNavigate()
  const { selectedDate } = useScheduleViewStateContext()

  const getActiveTab = (path: string) => {
    if (path.startsWith('/app/today')) return '/app/today'
    if (path.startsWith('/app/schedules')) return '/app/schedules'
    if (path.startsWith('/app/tasks')) return '/app/tasks'
    if (path.startsWith('/app/statistics')) return '/app/statistics'
    return '/app/today'
  }

  const activeTab = getActiveTab(activePath)

  const handleAddClick = () => {
    if (activePath.startsWith('/app/tasks')) {
      navigate('/app/tasks/new')
      return
    }
    if (activePath.startsWith('/app/schedules')) {
      const state = { initialDateKey: toDateKey(selectedDate) }
      navigate('/app/schedules/new', { state })
      return
    }
    // default: today → 일정 만들기로 안내
    const state = { initialDateKey: toDateKey(selectedDate) }
    navigate('/app/schedules/new', { state })
  }

  return (
    <nav className="bottom-tab">
      {tabs.map((tab) => (
        <NavLink
          key={tab.key}
          to={tab.path}
          className={['bottom-tab__item', activeTab === tab.path ? 'is-active' : '']
            .join(' ')
            .trim()}
        >
          <span className="bottom-tab__icon" aria-hidden>
            {tab.icon}
          </span>
          <span className="bottom-tab__label">{tab.label}</span>
        </NavLink>
      ))}
      <button
        type="button"
        aria-label="일정 추가"
        className="bottom-tab__item bottom-tab__item--add"
        onClick={handleAddClick}
      >
        <span className="bottom-tab__icon" aria-hidden>
          ＋
        </span>
      </button>
    </nav>
  )
}

export default BottomTabBar
