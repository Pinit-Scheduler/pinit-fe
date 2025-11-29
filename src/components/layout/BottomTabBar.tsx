import { NavLink } from 'react-router-dom'
import { useContext } from 'react'
import { ScheduleModalContext } from '../../context/ScheduleModalContext'
import './BottomTabBar.css'

type BottomTabBarProps = {
  activePath: string
}

const tabs = [
  { key: 'schedules', label: '일정', path: '/app/schedules', icon: '📅' },
  { key: 'statistics', label: '통계', path: '/app/statistics', icon: '📊' },
]

const BottomTabBar = ({ activePath }: BottomTabBarProps) => {
  const modal = useContext(ScheduleModalContext)

  const getActiveTab = (path: string) => {
    if (path.startsWith('/app/schedules')) return '/app/schedules'
    if (path.startsWith('/app/statistics')) return '/app/statistics'
    return '/app/schedules'
  }

  const activeTab = getActiveTab(activePath)

  const handleAddClick = () => {
    modal?.openCreate()
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
