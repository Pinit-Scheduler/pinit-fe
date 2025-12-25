import './App.css'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import SchedulesTabPage from './pages/schedule/tab/SchedulesTabPage.tsx'
import StatisticsTabPage from './pages/statistics/StatisticsTabPage.tsx'
import SettingsPage from './pages/setting/SettingsPage.tsx'
import { ScheduleCacheProvider } from './context/ScheduleCacheContext'
import { ScheduleViewStateProvider } from './context/ScheduleViewStateContext'
import { ToastProvider } from './context/ToastContext'
import { TimePreferencesProvider, useTimePreferences } from './context/TimePreferencesContext'
import LandingPage from './pages/landing/LandingPage.tsx'
import LoginPage from './pages/auth/LoginPage.tsx'
import ScheduleCreatePage from './pages/schedule/form/ScheduleCreatePage.tsx'
import ScheduleEditPage from './pages/schedule/form/ScheduleEditPage.tsx'
import SocialCallbackPage from './pages/auth/SocialCallbackPage.tsx'
import SignupPage from './pages/auth/SignupPage.tsx'
import AuthGuard from './components/auth/AuthGuard.tsx'

const AppContent = () => {
  const { offsetMinutes } = useTimePreferences()

  return (
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
                  <Route index element={<Navigate to="/app/schedules" replace />} />
                  <Route path="schedules" element={<SchedulesTabPage />} />
                  <Route path="schedules/:scheduleId/edit" element={<ScheduleEditPage />} />
                  <Route path="new" element={<ScheduleCreatePage />} />
                  <Route path="statistics" element={<StatisticsTabPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </ScheduleViewStateProvider>
    </ScheduleCacheProvider>
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
