import { Download, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { UpdateState } from '../../../shared/ipc-contract'
import { Button } from './Button'

export function UpdateStatus({
  initialState,
  onRetry
}: {
  initialState?: UpdateState
  onRetry?: () => void
}): React.JSX.Element | null {
  const [state, setState] = useState<UpdateState>(initialState ?? { status: 'idle' })

  useEffect(() => {
    if (initialState) setState(initialState)
  }, [initialState])

  useEffect(() => {
    if (initialState || !window.desktopApi) return
    void window.desktopApi.getUpdateState().then(setState)
    return window.desktopApi.onUpdateState(setState)
  }, [initialState])

  function retry(): void {
    setState({ status: 'checking' })
    if (onRetry) onRetry()
    else void window.desktopApi?.retryUpdate()
  }

  if (state.status === 'idle' || state.status === 'up_to_date' || state.status === 'checking' || state.status === 'available') return null

  if (state.status === 'error') {
    return <Button icon={<RefreshCw size={14} />} onClick={retry} variant="secondary">重试更新</Button>
  }

  const label = state.status === 'downloading'
    ? `正在下载更新 ${state.percent}%`
    : state.status === 'waiting_for_idle'
      ? '任务完成后自动更新'
      : '正在自动更新'

  return <span aria-live="polite" className="update-status"><Download size={14} />{label}</span>
}
