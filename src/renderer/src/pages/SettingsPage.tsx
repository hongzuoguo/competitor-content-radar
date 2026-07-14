import { Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { PublicSettings } from '../../../shared/ipc-contract'
import type { AiProviderId } from '../../../services/ai/provider-types'
import { Button } from '../components/Button'
import { AiProviderSettings } from '../features/settings/AiProviderSettings'
import { ConnectionSettings } from '../features/settings/ConnectionSettings'
import { RuleSettings } from '../features/settings/RuleSettings'
import './workspace-pages.css'

export function SettingsPage(): React.JSX.Element {
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (window.desktopApi) void window.desktopApi.getSettings().then(setSettings).catch(() => setSettings({}))
    else setSettings({})
  }, [])

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setMessage('正在保存…')
    try {
      const saved = await window.desktopApi?.saveSettings({
        providerId: String(data.get('providerId') ?? 'qwen'),
        modelId: String(data.get('modelId') ?? ''),
        apiKey: String(data.get('apiKey') ?? ''),
        customBaseUrl: String(data.get('customBaseUrl') ?? ''),
        dailyTime: '08:00',
        weeklyTime: String(data.get('weeklyTime') ?? '09:30'),
        absoluteLikes: Number(data.get('absoluteLikes') ?? 10_000),
        relativeViralIndex: Number(data.get('relativeViralIndex') ?? 150),
        referenceValueScore: Number(data.get('referenceValueScore') ?? 80),
        mediaRetentionDays: Number(data.get('mediaRetentionDays') ?? 7)
      })
      if (saved) setSettings(saved)
      setMessage('设置已保存')
    } catch {
      setMessage('保存失败，请检查配置后重试。')
    }
  }

  if (!settings) return <div className="page overview-skeleton" aria-label="正在加载设置"><span /><span /></div>

  return (
    <form className="page settings-page" key={`${settings.providerId}-${settings.modelId}`} onSubmit={(event) => void save(event)}>
      <header className="page-heading">
        <div><h1>设置</h1><p>连接账号、选择分析模型并调整自动运行规则。</p></div>
        <div><Button icon={<Save size={16} />} type="submit">保存设置</Button><span aria-live="polite" className="form-help">{message}</span></div>
      </header>
      <div className="settings-layout">
        <nav aria-label="设置目录">
          <a href="#connections">账号与同步</a><a href="#ai">AI 拆解模型</a>
          <a href="#schedule">自动运行</a><a href="#rules">判断标准</a><a href="#storage">文件清理</a>
        </nav>
        <div className="settings-content">
          <div id="connections"><ConnectionSettings douyinLoggedIn={settings.douyinLoggedIn} feishuConnected={settings.feishuConnected} onLogin={() => void window.desktopApi?.loginDouyin()} /></div>
          <div id="ai"><AiProviderSettings initialBaseUrl={settings.customBaseUrl} initialModel={settings.modelId} initialProvider={(settings.providerId as AiProviderId | undefined) ?? 'qwen'} /></div>
          <section className="settings-section" id="schedule">
            <div className="settings-section__heading"><div><h2>自动运行</h2><p>电脑关机错过任务后，下次启动会补跑一次。</p></div></div>
            <div className="settings-grid">
              <div className="form-field"><label htmlFor="daily-time">每日监控</label><input disabled id="daily-time" name="dailyTime" type="time" value="08:00" /></div>
              <div className="form-field"><label htmlFor="weekly-time">每周报告（周一）</label><input defaultValue={settings.weeklyTime ?? '09:30'} id="weekly-time" name="weeklyTime" type="time" /></div>
            </div>
          </section>
          <div id="rules"><RuleSettings absoluteLikes={settings.absoluteLikes} referenceValueScore={settings.referenceValueScore} relativeViralIndex={settings.relativeViralIndex} /></div>
          <section className="settings-section" id="storage">
            <div className="settings-section__heading"><div><h2>文件清理</h2><p>分析结果长期保留，原视频和音频自动清理。</p></div></div>
            <div className="settings-grid"><div className="form-field"><label htmlFor="retention">视频与音频保留时间</label><select defaultValue={String(settings.mediaRetentionDays ?? 7)} id="retention" name="mediaRetentionDays"><option value="3">3 天</option><option value="7">7 天</option><option value="14">14 天</option><option value="30">30 天</option></select></div></div>
          </section>
        </div>
      </div>
    </form>
  )
}
