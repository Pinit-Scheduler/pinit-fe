import { NavLink } from 'react-router-dom'
import { tabLinkClick } from '@shared/routing/viewTransitionNavigation'
import { useScheduleViewStateContext } from '@contexts/ScheduleViewStateContext'
import { toDateKey } from '@shared/utils/datetime'
import { useRouteSurfaceNavigation } from '@shared/routing/RouteSurface'
import WorkspaceIcon, { type WorkspaceIconName } from '../common/WorkspaceIcon'
import './BottomTabBar.css'
const tabs: [string, string, WorkspaceIconName][] = [
  ['today', '오늘', 'sun'],
  ['schedules', '일정', 'calendar'],
  ['tasks', '작업', 'task'],
  ['task-map', '작업 맵', 'map'],
  ['statistics', '통계', 'chart'],
]
export default function BottomTabBar({ activePath }: { activePath: string }) {
  const { selectedDate } = useScheduleViewStateContext()
  const { open } = useRouteSurfaceNavigation()
  const taskMode =
    activePath.startsWith('/app/tasks') ||
    activePath.startsWith('/app/task-map')
  return (
    <nav className="bottom-tab" aria-label="모바일 주 메뉴">
      {tabs.map(([path, label, icon]) => (
        <NavLink
          key={path}
          to={'/app/' + path}
          onClick={tabLinkClick('/app/' + path)}
          className={({ isActive }) =>
            'bottom-tab__item' + (isActive ? ' is-active' : '')
          }
        >
          <WorkspaceIcon name={icon} />
          <span>{label}</span>
        </NavLink>
      ))}
      <button
        type="button"
        aria-label={taskMode ? '작업 추가' : '일정 추가'}
        className="bottom-tab__item--add"
        onClick={() =>
          open(taskMode ? '/app/tasks/new' : '/app/schedules/new', {
            state: { initialDateKey: toDateKey(selectedDate) },
          })
        }
      >
        <WorkspaceIcon name="plus" />
      </button>
    </nav>
  )
}
