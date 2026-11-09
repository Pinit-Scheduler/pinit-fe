import { SpaceSwitcher, SpaceProjectsNav } from '@features/spaces/SpaceChrome'
import { useSpaces } from '@features/spaces/store'
import { Link, NavLink } from 'react-router-dom'
import WorkspaceIcon, { type WorkspaceIconName } from '../common/WorkspaceIcon'
const main: [string, string, WorkspaceIconName][] = [
  ['today', '오늘', 'sun'],
  ['spaces', '스페이스', 'spaces'],
  ['schedules', '일정', 'calendar'],
  ['tasks', '작업', 'task'],
  ['task-map', '작업 맵', 'map'],
  ['statistics', '통계', 'chart'],
]
const manage: [string, string, WorkspaceIconName][] = [
  ['settings/routines', '생활 시간', 'clock'],
  ['settings/recurrences', '반복 관리', 'repeat'],
  ['settings/trash', '휴지통', 'trash'],
  ['settings', '설정', 'settings'],
]
export default function WorkspaceSidebar() {
  const { nickname } = useSpaces()
  return (
    <aside className="workspace-sidebar">
      <Link className="workspace-brand" to="/app/today" aria-label="pinit 홈">
        <WorkspaceIcon name="pin" />
        <span>
          pinit<span className="workspace-brand__dot">.</span>
        </span>
      </Link>
      <SpaceSwitcher />
      <nav aria-label="주 메뉴">
        {main.map(([path, label, icon]) => (
          <NavLink key={path} to={'/app/' + path} viewTransition>
            <WorkspaceIcon name={icon} />
            {label}
          </NavLink>
        ))}
      </nav>
      <SpaceProjectsNav />
      <p className="workspace-nav-label">관리</p>
      <nav aria-label="관리 메뉴">
        {manage.map(([path, label, icon]) => (
          <NavLink
            key={path}
            end={path === 'settings'}
            to={'/app/' + path}
            viewTransition
          >
            <WorkspaceIcon name={icon} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="workspace-sidebar__footer">
        <span className="workspace-avatar">나</span>
        <div>
          <strong>{nickname || '내 계정'}</strong>
          <p>계정·사용 안내</p>
        </div>
        <Link to="/app/settings/onboarding" aria-label="사용 안내">
          ?
        </Link>
      </div>
    </aside>
  )
}
