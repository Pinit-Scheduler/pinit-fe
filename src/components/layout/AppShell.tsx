import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import TopBar from './TopBar'
import BottomTabBar from './BottomTabBar'
import MiniPlayerBar from '../schedules/MiniPlayerBar'
import useScheduleModal from '../../hooks/useScheduleModal'
import useScheduleDetail from '../../hooks/useScheduleDetail'
import ScheduleModal from '../modals/ScheduleModal'
import { ScheduleModalContext } from '../../context/ScheduleModalContext'
import './AppShell.css'

const TAB_TITLES: Record<string, string> = {
  '/app/schedules': '일정',
  '/app/new': '일정 추가',
  '/app/statistics': '통계',
  '/app/settings': '설정',
}

const getPageTitle = (pathname: string): string => {
  if (pathname.startsWith('/app/schedules/')) {
    return '일정 상세'
  }
  return TAB_TITLES[pathname] ?? '일정'
}

const AppShell = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const pathname = location.pathname

  const title = getPageTitle(pathname)
  const showSettingsButton = pathname !== '/app/settings'
  const isDetailPage = pathname.startsWith('/app/schedules/') && pathname.split('/').length > 3
  const showBackButton = isDetailPage || pathname === '/app/settings'

  const modalControls = useScheduleModal()
  const editScheduleId = modalControls.editScheduleId
  const editScheduleResult = useScheduleDetail(editScheduleId ? editScheduleId.toString() : undefined)
  const editSchedule = editScheduleResult.schedule

  return (
    <ScheduleModalContext.Provider value={modalControls}>
      <div className="app-shell">
        <TopBar
          title={title}
          showBackButton={showBackButton}
          onBack={() => navigate(-1)}
          onSettings={() => navigate('/app/settings')}
          showSettingsButton={showSettingsButton}
        />
        <main className="app-shell__content">
          <Outlet />
        </main>
        <MiniPlayerBar />
        <BottomTabBar activePath={pathname} />
        {modalControls.isCreateOpen && (
          <ScheduleModal mode="create" onClose={modalControls.closeCreate} />
        )}
        {modalControls.editScheduleId && (
          <ScheduleModal mode="edit" schedule={editSchedule} onClose={modalControls.closeEdit} />
        )}
      </div>
    </ScheduleModalContext.Provider>
  )
}

export default AppShell
