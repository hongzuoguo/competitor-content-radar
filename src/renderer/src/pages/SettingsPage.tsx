import { Save } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { feishuUserErrorFromUnknown, type FeishuConnectionView, type FeishuCustomAppConnectionInput, type FeishuUserError, type PublicSettings } from '../../../shared/ipc-contract'
import { FEISHU_TEMPLATE_URL } from '../../../shared/feishu-template'
import { Button } from '../components/Button'
import { AgentSettings } from '../features/settings/AgentSettings'
import { AdvancedSettings } from '../features/settings/AdvancedSettings'
import { ConnectionSettings } from '../features/settings/ConnectionSettings'
import { EngineHealthSettings } from '../features/settings/EngineHealthSettings'
import { ModelProfileSettings } from '../features/settings/ModelProfileSettings'
import { RuleSettings } from '../features/settings/RuleSettings'
import { validateFeishuRetentionDays } from '../features/settings/settings-validation'
import {
  AnalysisScopeSettings,
  validateAnalysisMaxWorks,
  validateAnalysisRecentDays
} from '../features/settings/AnalysisScopeSettings'
import './workspace-pages.css'

const RESTORE_SAFETY_NOTICE = '仅恢复采集、分析、同步和保留策略；不会清除账号凭证、飞书连接或已有数据。本地 Codex 的模型与推理强度将恢复默认。'

export function SettingsPage(): React.JSX.Element {
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [feishu, setFeishu] = useState<FeishuConnectionView>(DISCONNECTED_FEISHU)
  const [feishuActionFailure, setFeishuActionFailure] = useState<FeishuUserError | null>(null)
  const [feishuBusyAction, setFeishuBusyAction] = useState('')
  const [message, setMessage] = useState('')
  const [restoreMessage, setRestoreMessage] = useState('')
  const [restoring, setRestoring] = useState(false)
  const restoreInFlight = useRef(false)
  const [loginMessage, setLoginMessage] = useState('')
  const [showAnalysisScopeErrors, setShowAnalysisScopeErrors] = useState(false)
  const [showFeishuTimingErrors, setShowFeishuTimingErrors] = useState(false)
  const [currentSection, setCurrentSection] = useState('accounts')

  function navigateToSection(sectionId: string): void {
    setCurrentSection(sectionId)
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    document.getElementById(sectionId)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
  }

  useEffect(() => {
    if (window.desktopApi) void window.desktopApi.getSettings().then(setSettings).catch(() => setSettings({}))
    else setSettings({})
    void refreshFeishuConnection()
  }, [])

  async function refreshFeishuConnection(): Promise<void> {
    if (!window.desktopApi || typeof window.desktopApi.getFeishuConnection !== 'function') return
    try {
      setFeishu(await window.desktopApi.getFeishuConnection())
    } catch {
      setFeishu((current) => ({ ...current, status: current.status === 'connected' ? 'sync_error' : current.status, message: '无法读取飞书连接状态，请稍后重试。' }))
    }
  }

  async function runFeishuAction(action: string, operation: () => Promise<unknown>): Promise<void> {
    if (feishuBusyAction) return
    const previous = feishu
    setFeishuBusyAction(action)
    setFeishuActionFailure(null)
    if (action === 'sync') {
      setFeishu((current) => ({ ...current, message: '' }))
    } else if (action === 'repair') {
      setFeishu((current) => ({ ...current, status: 'provisioning', message: '正在检查并修复四张数据表。' }))
    }
    try {
      await operation()
      await refreshFeishuConnection()
    } catch (error) {
      setFeishuActionFailure(feishuUserErrorFromUnknown(error))
      if (action === 'sync') {
        try {
          setFeishu(await window.desktopApi.getFeishuConnection())
        } catch {
          setFeishu({ ...previous, status: 'sync_error', message: feishuActionError(action) })
        }
      } else {
        setFeishu({
          ...previous,
          status: previous.status === 'disconnected' ? 'disconnected' : 'sync_error',
          message: feishuActionError(action)
        })
      }
    } finally {
      setFeishuBusyAction('')
    }
  }

  async function connectFeishu(input: FeishuCustomAppConnectionInput): Promise<void> {
    if (feishuBusyAction) return
    const previous = feishu
    setFeishuBusyAction('connect')
    setFeishuActionFailure(null)
    setFeishu((current) => ({ ...current, status: 'provisioning', message: '正在验证应用权限和多维表格。' }))
    try {
      const connected = await window.desktopApi.connectFeishuCustomApp(input)
      setFeishu(connected)
    } catch (error) {
      setFeishu(previous)
      throw error
    } finally {
      setFeishuBusyAction('')
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!settings) return
    const data = new FormData(event.currentTarget)
    const analysisMaxWorks = String(data.get('analysisMaxWorksPerCreator') ?? '')
    const analysisRecentDays = String(data.get('analysisRecentDays') ?? '')
    const feishuSyncRecentDays = String(data.get('feishuSyncRecentDays') ?? '')
    const feishuRetentionDays = String(data.get('feishuRetentionDays') ?? '')
    if (validateAnalysisMaxWorks(analysisMaxWorks) || validateAnalysisRecentDays(analysisRecentDays) || validateFeishuRetentionDays(feishuSyncRecentDays) || validateFeishuRetentionDays(feishuRetentionDays)) {
      setShowAnalysisScopeErrors(true)
      setShowFeishuTimingErrors(true)
      setMessage('请先修正设置。')
      return
    }
    setShowAnalysisScopeErrors(false)
    setShowFeishuTimingErrors(false)
    setMessage('正在保存…')
    try {
      const saved = await window.desktopApi?.saveSettings({
        absoluteLikes: Number(data.get('absoluteLikes') ?? 10_000),
        highCollects: Number(data.get('highCollects') ?? 3_000),
        highComments: Number(data.get('highComments') ?? 500),
        highShares: Number(data.get('highShares') ?? 500),
        relativePerformanceSurgeMultiplier: Number(data.get('relativePerformanceSurgeMultiplier') ?? 80),
        relativePerformanceMultiplier: Number(data.get('relativePerformanceMultiplier') ?? 3),
        analysisMaxWorksPerCreator: Number(analysisMaxWorks),
        analysisRecentDays: Number(analysisRecentDays),
        feishuSyncMode: data.get('feishuSyncMode') === 'manual' ? 'manual' : 'auto',
        feishuSyncRecentDays: Number(feishuSyncRecentDays),
        feishuRetentionDays: Number(feishuRetentionDays),
        runEngine: settings.runEngine,
        mediaRetentionDays: Number(data.get('mediaRetentionDays') ?? 7)
      })
      if (saved) setSettings(saved)
      setMessage('设置已保存')
    } catch {
      setMessage('保存失败，请检查配置后重试。')
    }
  }

  async function restoreRecommendedSettings(): Promise<void> {
    if (restoreInFlight.current || !window.confirm(RESTORE_SAFETY_NOTICE)) return
    if (!window.desktopApi || typeof window.desktopApi.restoreRecommendedBehaviorSettings !== 'function') return
    restoreInFlight.current = true
    setRestoring(true)
    setMessage('')
    setRestoreMessage('')
    try {
      const restored = await window.desktopApi.restoreRecommendedBehaviorSettings()
      setSettings(restored)
      await refreshFeishuConnection()
      window.dispatchEvent(new Event('content-radar:engine-health-changed'))
      setMessage('已恢复推荐设置')
    } catch {
      setRestoreMessage('恢复推荐设置失败，请稍后重试。')
    } finally {
      restoreInFlight.current = false
      setRestoring(false)
    }
  }

  async function openDouyinLogin(): Promise<void> {
    setLoginMessage('正在打开专用浏览器…')
    try {
      await window.desktopApi.loginDouyin()
      setLoginMessage('浏览器已打开，登录完成后可直接关闭浏览器。')
    } catch {
      setLoginMessage('浏览器启动失败，请重新打开应用后再试。')
    }
  }

  async function checkDouyinLogin(): Promise<void> {
    setLoginMessage('正在检测登录状态…')
    try {
      const result = await window.desktopApi.checkDouyinLogin()
      setLoginMessage(result.loggedIn ? '已检测到抖音登录状态。' : '未检测到登录，请先打开浏览器登录。')
      const next = await window.desktopApi.getSettings()
      setSettings(next)
    } catch {
      setLoginMessage('检测失败，请稍后重试。')
    }
  }

  async function logoutDouyin(): Promise<void> {
    setLoginMessage('正在清除登录会话…')
    try {
      await window.desktopApi.logoutDouyin()
      setLoginMessage('已登出抖音，可重新登录。')
      const next = await window.desktopApi.getSettings()
      setSettings(next)
    } catch {
      setLoginMessage('登出失败，请稍后重试。')
    }
  }

  if (!settings) return <div className="page overview-skeleton" aria-label="正在加载设置"><span /><span /></div>

  return (
    <form className="page settings-page" key={`${settings.providerId}-${settings.modelId}`} onSubmit={(event) => void save(event)}>
      <header className="page-heading settings-page-heading">
        <div><h1>设置</h1><p>连接账号、选择分析模型，并配置同步与拆解规则。</p></div>
        <div className="settings-page-heading__actions"><Button className="settings-save-action glass-button" icon={<Save size={16} />} type="submit">保存设置</Button><span aria-live="polite" className="form-help">{message || '所有更改保存在本地'}</span></div>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分区">
          <button aria-current={currentSection === 'accounts' ? 'location' : undefined} onClick={() => navigateToSection('accounts')} type="button">账号配置</button>
          <button aria-current={currentSection === 'data-thresholds' ? 'location' : undefined} onClick={() => navigateToSection('data-thresholds')} type="button">数据阈值</button>
          <button aria-current={currentSection === 'models' ? 'location' : undefined} onClick={() => navigateToSection('models')} type="button">模型配置</button>
          <button aria-current={currentSection === 'storage' ? 'location' : undefined} onClick={() => navigateToSection('storage')} type="button">媒体清理</button>
        </nav>
        <div className="settings-content">
          <section className="settings-region" id="accounts" aria-labelledby="accounts-title">
            <div className="settings-region__heading"><h2 id="accounts-title">账号配置</h2><p>管理采集账号和同步目标。</p></div>
            <ConnectionSettings
            key={`${settings.feishuSyncMode}-${settings.feishuSyncRecentDays}-${settings.feishuRetentionDays}`}
            busyAction={feishuBusyAction}
            douyinLoggedIn={settings.douyinLoggedIn}
            feishu={feishu}
            feishuActionError={feishuActionFailure}
            feishuRetentionDays={settings.feishuRetentionDays}
            feishuSyncMode={settings.feishuSyncMode}
            feishuSyncRecentDays={settings.feishuSyncRecentDays}
            loginMessage={loginMessage}
            showFeishuTimingErrors={showFeishuTimingErrors}
            onConnect={connectFeishu}
            onDisconnect={() => void runFeishuAction('disconnect', () => window.desktopApi.disconnectFeishu())}
            onLogin={() => void openDouyinLogin()}
            onLogout={() => void logoutDouyin()}
            onCheckLogin={() => void checkDouyinLogin()}
            onOpen={() => void runFeishuAction('open', () => window.desktopApi.openFeishuBase())}
            onOpenTemplate={() => window.desktopApi.openExternal(FEISHU_TEMPLATE_URL)}
            onOpenDeveloperConsole={() => void window.desktopApi.openFeishuDeveloperConsole()}
            onRepair={(appToken) => void runFeishuAction('repair', () => window.desktopApi.repairFeishu(appToken))}
            onRecreate={() => void runFeishuAction('repair', () => window.desktopApi.recreateFeishu())}
            onSync={() => void runFeishuAction('sync', () => window.desktopApi.syncFeishu())}
            />
          </section>
          <section className="settings-region" id="data-thresholds" aria-labelledby="data-thresholds-title">
            <div className="settings-region__heading"><h2 id="data-thresholds-title">数据阈值</h2><p>限定拆解规模，并定义值得关注的内容表现。</p></div>
            <AnalysisScopeSettings key={`${settings.analysisMaxWorksPerCreator}-${settings.analysisRecentDays}`} maxWorksPerCreator={settings.analysisMaxWorksPerCreator} recentDays={settings.analysisRecentDays} showErrors={showAnalysisScopeErrors} />
            <RuleSettings
              key={[settings.absoluteLikes, settings.highCollects, settings.highComments, settings.highShares, settings.relativePerformanceMultiplier, settings.relativePerformanceSurgeMultiplier].join('-')}
              absoluteLikes={settings.absoluteLikes}
              highCollects={settings.highCollects}
              highComments={settings.highComments}
              highShares={settings.highShares}
              relativePerformanceSurgeMultiplier={settings.relativePerformanceSurgeMultiplier}
              relativePerformanceMultiplier={settings.relativePerformanceMultiplier}
            />
            <div className="settings-recommended-reset" aria-label="推荐设置">
              <span>{RESTORE_SAFETY_NOTICE}</span>
              <Button disabled={restoring} onClick={() => void restoreRecommendedSettings()} type="button" variant="ghost">恢复推荐设置</Button>
              {restoreMessage ? <span role="alert">{restoreMessage}</span> : null}
            </div>
          </section>
          <section className="settings-region" id="models" aria-labelledby="models-title">
            <div className="settings-region__heading"><h2 id="models-title">模型配置</h2><p>检查可用性，并管理云端与本地 Codex 的配置。</p></div>
            <EngineHealthSettings />
            <AdvancedSettings title="模型与本地 Codex 详情"><ModelProfileSettings /><AgentSettings key={`${settings.agentModel ?? ''}-${settings.agentReasoningEffort ?? ''}`} supported={Boolean(window.desktopApi && typeof window.desktopApi.getAgentStatus === 'function')} /></AdvancedSettings>
          </section>
          <section className="settings-region" id="storage" aria-labelledby="storage-title">
            <div className="settings-region__heading"><h2 id="storage-title">媒体清理</h2><p>分析结果长期保留，原视频和音频按策略清理。</p></div>
            <div className="settings-grid"><div className="form-field form-field--horizontal form-field--align-right"><label htmlFor="retention">视频与音频保留时间</label><select defaultValue={String(settings.mediaRetentionDays ?? 7)} id="retention" key={settings.mediaRetentionDays} name="mediaRetentionDays"><option value="3">3 天</option><option value="7">7 天</option><option value="14">14 天</option><option value="30">30 天</option></select></div></div>
          </section>
        </div>
      </div>
    </form>
  )
}

const DISCONNECTED_FEISHU: FeishuConnectionView = {
  status: 'disconnected',
  baseName: null,
  baseUrl: null,
  lastSyncedAt: null,
  message: '',
  customAppConfigured: false,
  maskedAppId: null
}

function feishuActionError(action: string): string {
  if (action === 'sync') return '同步未完成，本地数据已经保留，请稍后重试。'
  if (action === 'repair') return '表格修复未完成，请根据上方错误检查字段类型或应用权限后重试。'
  if (action === 'disconnect') return '暂时无法断开连接，请稍后重试。'
  return '暂时无法打开飞书表格，请稍后重试。'
}
