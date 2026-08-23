import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineHealthEntry, EngineHealthView } from '../../../../shared/ipc-contract'
import { Button } from '../../components/Button'

const ENGINE_HEALTH_CHANGED = 'content-radar:engine-health-changed'

const UNKNOWN_ENGINE_HEALTH: EngineHealthView = {
  cloud: { status: 'unknown', checkedAt: null, fingerprint: null, code: null, message: null },
  codex: { status: 'unknown', checkedAt: null, fingerprint: null, code: null, message: null },
  checking: false
}

function checkingView(view: EngineHealthView): EngineHealthView {
  return {
    cloud: { ...view.cloud, status: 'checking', checkedAt: null, code: null, message: null },
    codex: { ...view.codex, status: 'checking', checkedAt: null, code: null, message: null },
    checking: true
  }
}

function unknownView(view: EngineHealthView): EngineHealthView {
  const entry = (current: EngineHealthEntry): EngineHealthEntry => ({
    status: 'unknown', checkedAt: null, fingerprint: current.fingerprint, code: null, message: null
  })
  return { cloud: entry(view.cloud), codex: entry(view.codex), checking: false }
}

export function EngineHealthSettings(): React.JSX.Element | null {
  const api = window.desktopApi
  const supported = Boolean(api && typeof api.getEngineHealth === 'function' && typeof api.refreshEngineHealth === 'function')
  const [health, setHealth] = useState<EngineHealthView>(UNKNOWN_ENGINE_HEALTH)
  const [message, setMessage] = useState('')
  const refreshGeneration = useRef(0)
  const refreshInFlight = useRef(false)

  const reread = useCallback(async (): Promise<void> => {
    if (!supported) return
    const generation = refreshGeneration.current
    try {
      const next = await api.getEngineHealth()
      if (generation === refreshGeneration.current && !refreshInFlight.current) setHealth(next)
    } catch {
      if (generation === refreshGeneration.current && !refreshInFlight.current) {
        setMessage('无法读取已保存的模型状态，请稍后重试。')
      }
    }
  }, [api, supported])

  useEffect(() => {
    void reread()
    const onChanged = (): void => { void reread() }
    window.addEventListener(ENGINE_HEALTH_CHANGED, onChanged)
    return () => window.removeEventListener(ENGINE_HEALTH_CHANGED, onChanged)
  }, [reread])

  const refresh = useCallback(async (): Promise<void> => {
    if (!supported || refreshInFlight.current) return
    refreshInFlight.current = true
    refreshGeneration.current += 1
    setMessage('')
    setHealth(checkingView(health))
    try {
      const next = await api.refreshEngineHealth()
      setHealth(next)
      window.dispatchEvent(new Event(ENGINE_HEALTH_CHANGED))
    } catch {
      setHealth((current) => unknownView(current))
      setMessage('模型状态刷新失败，请检查网络和配置后重试。')
    } finally {
      refreshInFlight.current = false
    }
  }, [api, health, supported])

  if (!supported) return null

  return (
    <section className="settings-section engine-health" aria-labelledby="engine-health-title">
      <div className="settings-section__heading">
        <div>
          <h3 id="engine-health-title">验证状态</h3>
          <p>绿色表示当前配置已完成一次真实的最小请求，不只是已经填写配置。</p>
        </div>
        <Button data-testid="engine-health-refresh" disabled={health.checking} icon={<RefreshCw size={16} />} onClick={() => void refresh()} type="button">
          {health.checking ? '正在检测…' : '刷新状态'}
        </Button>
      </div>
      <div className="engine-health__rows" aria-live="polite">
        <EngineStatus entry={health.cloud} label="云端模型" testId="engine-health-cloud" />
        <EngineStatus entry={health.codex} label="本地 Codex" testId="engine-health-codex" />
      </div>
      <small className="engine-health__usage">每个引擎都只会发送一次最小请求，可能产生极少量模型用量。</small>
      {message && <p className="form-help" role="alert">{message}</p>}
    </section>
  )
}

function EngineStatus({ entry, label, testId }: { entry: EngineHealthEntry, label: string, testId: string }): React.JSX.Element {
  return (
    <div className="engine-health__row" data-status={entry.status} data-testid={testId}>
      <span className={`engine-health__dot is-${entry.status}`} aria-hidden="true" />
      <span><strong>{label}</strong><small>{statusCopy(entry)}</small></span>
    </div>
  )
}

function statusCopy(entry: EngineHealthEntry): string {
  if (entry.status === 'checking') return '正在发送最小请求验证'
  if (entry.status === 'healthy') return entry.checkedAt ? `已验证：${formatCheckedAt(entry.checkedAt)}` : '已验证'
  if (entry.status === 'unhealthy') {
    const message = entry.message ?? '检测失败，请检查配置后重试。'
    return entry.code ? `${message}（${entry.code}）` : message
  }
  return '尚未验证'
}

function formatCheckedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '刚刚'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}
