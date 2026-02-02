import './App.css'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from '@shared/components/layout/AppShell'
import { ScheduleCacheProvider } from '@contexts/ScheduleCacheContext'
import { ScheduleViewStateProvider } from '@contexts/ScheduleViewStateContext'
import { ToastProvider } from '@contexts/ToastContext'
import { TaskCacheProvider } from '@contexts/TaskCacheContext'
import { TimePreferencesProvider, useTimePreferences } from '@contexts/TimePreferencesContext'
import { LandingPage } from '@features/landing'
import { LoginPage, SignupPage, SocialCallbackPage, AuthGuard } from '@features/auth'
import { ScheduleCreatePage, ScheduleEditPage, SchedulesTabPage } from '@features/schedules'
import { TodayPage } from '@features/today'
import { TaskListPage, TaskCreatePage, TaskEditPage, TaskDetailPage } from '@features/tasks'
import { StatisticsTabPage } from '@features/statistics'
import { SettingsPage } from '@features/settings'

const InitialLoadingScreen = () => {
  return (
    <div className="app-loading" role="status" aria-live="polite">
      <div className="app-loading__spinner" aria-hidden />
      <p className="app-loading__text">시간대를 불러오는 중이에요</p>
      <p className="app-loading__subtext">현재 시간대에 맞춰 화면을 준비하고 있어요.</p>
    </div>
  )
}

const AppContent = () => {
  const { offsetMinutes, isLoading } = useTimePreferences()

  if (isLoading) {
    return <InitialLoadingScreen />
  }

  return (
    <TaskCacheProvider>
      <ScheduleCacheProvider>
        <ScheduleViewStateProvider key={offsetMinutes}>
          <ToastProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/login/callback/:provider" element={<SocialCallbackPage />} />
                <Route element={<AuthGuard />}>
                  <Route path="/app" element={<AppShell />}>
                    <Route index element={<Navigate to="/app/today" replace />} />
                    <Route path="today" element={<TodayPage />} />
                    <Route path="schedules" element={<SchedulesTabPage />} />
                    <Route path="schedules/new" element={<ScheduleCreatePage />} />
                    <Route path="schedules/:scheduleId/edit" element={<ScheduleEditPage />} />
                    <Route path="new" element={<ScheduleCreatePage />} />
                    <Route path="tasks" element={<TaskListPage />} />
                    <Route path="tasks/new" element={<TaskCreatePage />} />
                    <Route path="tasks/:taskId" element={<TaskDetailPage />} />
                    <Route path="tasks/:taskId/edit" element={<TaskEditPage />} />
                    <Route path="statistics" element={<StatisticsTabPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                  </Route>
                </Route>
              </Routes>
            </BrowserRouter>
          </ToastProvider>
        </ScheduleViewStateProvider>
      </ScheduleCacheProvider>
    </TaskCacheProvider>
  )
}

function App() {
  return (
    <TimePreferencesProvider>
      <AppContent />
    </TimePreferencesProvider>
  )
}

export default App
