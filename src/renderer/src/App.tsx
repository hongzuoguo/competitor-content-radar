import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { AppShell } from './components/AppShell'
import { OverviewPage } from './pages/OverviewPage'
import { CreatorsPage } from './pages/CreatorsPage'
import { SettingsPage } from './pages/SettingsPage'
import { TasksPage } from './pages/TasksPage'
import { WorksPage } from './pages/WorksPage'
import { ChangelogPage } from './pages/ChangelogPage'
import type { WorkFocusRequest } from '../../shared/ipc-contract'
import type { SubscriptionFilter } from './features/works/SubscriptionWorkList'

export function App(): React.JSX.Element {
  return <BusinessApp />
}

function BusinessApp(): React.JSX.Element {
  const navigate = useNavigate()
  const [focusRequest, setFocusRequest] = useState<WorkFocusRequest>()
  const [workFilter, setWorkFilter] = useState<SubscriptionFilter>('all')
  useEffect(() => {
    if (typeof window.desktopApi?.onWorkFocusRequested !== 'function') return
    return window.desktopApi.onWorkFocusRequested((request) => {
      setFocusRequest(request)
      setWorkFilter('all')
      navigate('/works')
    })
  }, [navigate])
  function openWork(workId: string): void {
    setFocusRequest({ workId, requestId: `${Date.now()}-${workId}` })
    setWorkFilter('all')
    navigate('/works')
  }
  function openWorkFilter(filter: SubscriptionFilter): void {
    setFocusRequest(undefined)
    setWorkFilter(filter)
    navigate('/works')
  }
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<OverviewPage onOpenFilter={openWorkFilter} onOpenWork={openWork} />} />
        <Route path="/creators" element={<CreatorsPage />} />
        <Route path="/works" element={<WorksPage focusRequest={focusRequest} initialFilter={workFilter} />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/changelog" element={<ChangelogPage />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </AppShell>
  )
}
