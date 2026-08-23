import { ChevronDown, Play } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineHealthEntry, EngineHealthView, PublicSettings } from '../../../shared/ipc-contract'
import { Button } from './Button'
import { UpdateStatus } from './UpdateStatus'
import './topbar.css'

type Engine = 'cloud' | 'local-agent'

interface EngineOption {
  id: Engine
  label: string
  health: EngineHealthEntry
}

const UNKNOWN_ENGINE_HEALTH: EngineHealthView = {
  cloud: { status: 'unknown', checkedAt: null, fingerprint: null, code: null, message: null },
  codex: { status: 'unknown', checkedAt: null, fingerprint: null, code: null, message: null },
  checking: false
}

export function Topbar(): React.JSX.Element {
  const [runState, setRunState] = useState<'idle' | 'running' | 'accepted' | 'rejected'>('idle')
  const [runMessage, setRunMessage] = useState('')
  const [engine, setEngine] = useState<Engine>('cloud')
  const [menuOpen, setMenuOpen] = useState(false)
  const [health, setHealth] = useState<EngineHealthView>(UNKNOWN_ENGINE_HEALTH)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const refreshEngineState = useCallback(async (): Promise<void> => {
    const api = window.desktopApi
    if (!api) return
    let settings: PublicSettings | null = null
    try {
      settings = await api.getSettings()
      if (settings.runEngine === 'local-agent' || settings.runEngine === 'cloud') setEngine(settings.runEngine)
    } catch { /* keep current */ }
    try {
      setHealth(await api.peekEngineHealth())
    } catch { setHealth(UNKNOWN_ENGINE_HEALTH) }
  }, [])

  useEffect(() => {
    void refreshEngineState()
    const onFocus = (): void => { void refreshEngineState() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('content-radar:engine-health-changed', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('content-radar:engine-health-changed', onFocus)
    }
  }, [refreshEngineState])

  useEffect(() => {
    function onClickOutside(event: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMenuOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  async function selectEngine(next: Engine): Promise<void> {
    if (next === engine) {
      setMenuOpen(false)
      triggerRef.current?.focus()
      return
    }
    setEngine(next)
    setMenuOpen(false)
    triggerRef.current?.focus()
    const api = window.desktopApi
    if (!api) return
    try {
      const current = await api.getSettings()
      await api.saveSettings({ ...current, runEngine: next })
    } catch { /* keep UI state; persistence is best effort */ }
  }

  async function runNow(): Promise<void> {
    if (!window.desktopApi || runState === 'running') return
    setRunState('running')
    setRunMessage('正在提交任务…')
    try {
      const result = await window.desktopApi.runNow()
      if (result.accepted) {
        setRunState('accepted')
        setRunMessage('任务已启动，请到总览查看进度')
        window.dispatchEvent(new Event('content-radar:run-started'))
      } else {
        setRunState('rejected')
        const reasonMap: Record<string, string> = {
          MODEL_NOT_CONFIGURED: '云端模型未配置，请前往「设置」配置 API Key 后再运行',
          AGENT_CLI_NOT_FOUND: '未检测到 Codex CLI，请先安装并登录 Codex，然后到「设置」重新检测'
        }
        setRunMessage(reasonMap[result.reason ?? ''] ?? (result.reason ?? '任务未能启动，请稍后重试'))
        if (result.reason === 'MODEL_NOT_CONFIGURED' || result.reason === 'AGENT_CLI_NOT_FOUND') {
          window.location.hash = '#/settings'
        }
      }
    } catch {
      setRunState('rejected')
      setRunMessage('任务启动失败，请稍后重试')
    }
  }

  const options: EngineOption[] = [
    {
      id: 'cloud',
      label: '云端模型',
      health: health.cloud
    },
    {
      id: 'local-agent',
      label: '本地 Codex',
      health: health.codex
    }
  ]
  const selected = options.find((option) => option.id === engine) ?? options[0]

  return (
    <header className="topbar glass-toolbar">
      <div className="topbar__status">
        <UpdateStatus />
      </div>
      <div className="topbar__run">
        <span aria-live="polite" className="topbar__run-message" data-state={runState}>{runMessage}</span>
        <div className="engine-select" ref={menuRef}>
          <button
            aria-controls="engine-options"
            aria-expanded={menuOpen}
            className="engine-select__trigger"
            onClick={() => setMenuOpen((open) => !open)}
            ref={triggerRef}
            type="button"
          >
            <span className={`engine-status-dot is-${selected.health.status}`} data-status={selected.health.status} data-testid={`engine-status-${selected.id}`} title={engineStatusLabel(selected.health)} />
            {selected.label}
            <ChevronDown size={14} />
          </button>
          {menuOpen && (
            <div aria-label="运行引擎" className="engine-select__menu glass-panel" id="engine-options" role="group">
              {options.map((option) => (
                <button
                  className={`engine-select__item ${option.id === engine ? 'is-selected' : ''}`}
                  aria-pressed={option.id === engine}
                  key={option.id}
                  onClick={() => void selectEngine(option.id)}
                  type="button"
                >
                  <span className={`engine-status-dot is-${option.health.status}`} data-status={option.health.status} data-testid={`engine-status-${option.id}`} />
                  <span className="engine-select__item-text">
                    <strong>{option.label}</strong>
                    <small>{engineStatusLabel(option.health)}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Button className="topbar__primary-action glass-button" disabled={runState === 'running'} icon={<Play size={15} fill="currentColor" />} onClick={() => void runNow()}>{runState === 'running' ? '正在启动' : '立即运行'}</Button>
      </div>
    </header>
  )
}

function engineStatusLabel(entry: EngineHealthEntry): string {
  if (entry.status === 'healthy') return '已验证可用'
  if (entry.status === 'checking') return '正在验证'
  if (entry.status === 'unhealthy') {
    const message = entry.message ?? '验证失败'
    return entry.code ? `${message}（${entry.code}）` : message
  }
  return '尚未验证'
}
