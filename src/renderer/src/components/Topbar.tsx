import { Clock3, Play } from 'lucide-react'
import { useState } from 'react'
import { Button } from './Button'
import { StatusBadge } from './StatusBadge'
import { UpdateStatus } from './UpdateStatus'
import './topbar.css'

export function Topbar(): React.JSX.Element {
  const [runState, setRunState] = useState<'idle' | 'running' | 'accepted' | 'rejected'>('idle')
  const [runMessage, setRunMessage] = useState('')

  async function runNow(): Promise<void> {
    if (!window.desktopApi || runState === 'running') return
    setRunState('running')
    setRunMessage('正在提交任务…')
    try {
      const result = await window.desktopApi.runNow()
      setRunState(result.accepted ? 'accepted' : 'rejected')
      setRunMessage(result.accepted ? '任务已启动，请到总览查看进度' : (result.reason ?? '任务未能启动'))
    } catch {
      setRunState('rejected')
      setRunMessage('任务启动失败，请稍后重试')
    }
  }
  return (
    <header className="topbar">
      <div className="topbar__status">
        <StatusBadge tone="success">服务正常</StatusBadge>
        <span className="topbar__next"><Clock3 size={15} aria-hidden="true" />下次运行 08:00</span>
        <UpdateStatus />
      </div>
      <div className="topbar__run"><span aria-live="polite" className="topbar__run-message" data-state={runState}>{runMessage}</span><Button disabled={runState === 'running'} icon={<Play size={15} fill="currentColor" />} onClick={() => void runNow()}>{runState === 'running' ? '正在启动' : '立即运行'}</Button></div>
    </header>
  )
}
