import { useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="app-shell" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
      <div className="workspace">
        <Topbar />
        <main className="page-scroll" id="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  )
}
