import { Clock3, Play } from 'lucide-react'
import { useState } from 'react'
import { Button } from './Button'
import { StatusBadge } from './StatusBadge'
import { UpdateStatus } from './UpdateStatus'
import './topbar.css'

export function Topbar(): React.JSX.Element {
  const [runState, setRunState] = useState<'idle' | 'running' | 'accepted' | 'rejected'>('idle')

  async function runNow(): Promise<void> {
    if (!window.desktopApi || runState === 'running') return
    setRunState('running')
    try {
      const result = await window.desktopApi.runNow()
      setRunState(result.accepted ? 'accepted' : 'rejected')
    } catch {
      setRunState('rejected')
    }
  }
  return (
    <header className="topbar">
      <div className="topbar__status">
        <StatusBadge tone="success">服务正常</StatusBadge>
        <span className="topbar__next"><Clock3 size={15} aria-hidden="true" />下次运行 09:00</span>
        <UpdateStatus />
      </div>
      <div><Button disabled={runState === 'running'} icon={<Play size={15} fill="currentColor" />} onClick={() => void runNow()}>{runState === 'running' ? '正在启动' : '立即运行'}</Button><span aria-live="polite" className="visually-hidden">{runState === 'accepted' ? '任务已开始运行' : runState === 'rejected' ? '任务未能启动，可能已有任务正在运行' : ''}</span></div>
    </header>
  )
}
