import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { OverviewPage } from './pages/OverviewPage'
import { CreatorsPage } from './pages/CreatorsPage'
import { SettingsPage } from './pages/SettingsPage'
import { TasksPage } from './pages/TasksPage'
import { WorksPage } from './pages/WorksPage'
import { SetupWizard } from './features/onboarding/SetupWizard'

export function App(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  if (location.pathname === '/setup') {
    return <SetupWizard onComplete={() => navigate('/')} />
  }
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/creators" element={<CreatorsPage />} />
        <Route path="/works" element={<WorksPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </AppShell>
  )
}
