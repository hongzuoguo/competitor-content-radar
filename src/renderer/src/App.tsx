import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { PlaceholderPage } from './pages/PlaceholderPage'

export function App(): React.JSX.Element {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<PlaceholderPage title="今日总览" />} />
        <Route path="/creators" element={<PlaceholderPage title="博主管理" />} />
        <Route path="/works" element={<PlaceholderPage title="作品分析" />} />
        <Route path="/tasks" element={<PlaceholderPage title="任务记录" />} />
        <Route path="/settings" element={<PlaceholderPage title="设置" />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </AppShell>
  )
}
