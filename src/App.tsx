import './App.css'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import SchedulesTabPage from './pages/SchedulesTabPage'
import ScheduleCreateTabPage from './pages/ScheduleCreateTabPage'
import StatisticsTabPage from './pages/StatisticsTabPage'
import SettingsPage from './pages/SettingsPage'
import ScheduleDetailPage from './pages/ScheduleDetailPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<SchedulesTabPage />} />
          <Route path="/app/schedules" element={<SchedulesTabPage />} />
          <Route path="/app/new" element={<ScheduleCreateTabPage />} />
          <Route path="/app/statistics" element={<StatisticsTabPage />} />
          <Route path="/app/settings" element={<SettingsPage />} />
          <Route path="/app/schedules/:scheduleId" element={<ScheduleDetailPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
