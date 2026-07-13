import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { AppShell } from './components/AppShell'
import { OverviewPage } from './pages/OverviewPage'
import { CreatorsPage } from './pages/CreatorsPage'
import { SettingsPage } from './pages/SettingsPage'
import { TasksPage } from './pages/TasksPage'
import { WorksPage } from './pages/WorksPage'
import { SetupWizard, type SetupValues } from './features/onboarding/SetupWizard'
import type { WorkFocusRequest } from '../../shared/ipc-contract'

export function App(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const [focusRequest, setFocusRequest] = useState<WorkFocusRequest>()
  useEffect(() => {
    if (typeof window.desktopApi?.onWorkFocusRequested !== 'function') return
    return window.desktopApi.onWorkFocusRequested((request) => {
      setFocusRequest(request)
      navigate('/works')
    })
  }, [navigate])
  async function completeSetup(values: SetupValues): Promise<void> {
    await window.desktopApi?.saveSettings(values)
    await window.desktopApi?.addCreator(values.creatorUrl)
    navigate('/')
  }
  if (location.pathname === '/setup') {
    return <SetupWizard onComplete={completeSetup} onLogin={() => window.desktopApi?.loginDouyin() ?? Promise.resolve()} />
  }
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/creators" element={<CreatorsPage />} />
        <Route path="/works" element={<WorksPage focusRequest={focusRequest} />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </AppShell>
  )
}
