import { Save } from 'lucide-react'
import { Button } from '../components/Button'
import { AiProviderSettings } from '../features/settings/AiProviderSettings'
import { ConnectionSettings } from '../features/settings/ConnectionSettings'
import { RuleSettings } from '../features/settings/RuleSettings'
import './workspace-pages.css'

export function SettingsPage(): React.JSX.Element {
  return (
    <form className="page settings-page" onSubmit={(event) => event.preventDefault()}>
      <header className="page-heading">
        <div><h1>设置</h1><p>连接账号、选择分析模型并调整自动运行规则。</p></div>
        <Button icon={<Save size={16} />} type="submit">保存设置</Button>
      </header>
      <div className="settings-layout">
        <nav aria-label="设置目录">
          <a href="#connections">账号与同步</a><a href="#ai">AI 拆解模型</a>
          <a href="#schedule">自动运行</a><a href="#rules">判断标准</a><a href="#storage">文件清理</a>
        </nav>
        <div className="settings-content">
          <div id="connections"><ConnectionSettings /></div>
          <div id="ai"><AiProviderSettings /></div>
          <section className="settings-section" id="schedule">
            <div className="settings-section__heading"><div><h2>自动运行</h2><p>电脑关机错过任务后，下次启动会补跑一次。</p></div></div>
            <div className="settings-grid">
              <div className="form-field"><label htmlFor="daily-time">每日监控</label><input defaultValue="09:00" id="daily-time" type="time" /></div>
              <div className="form-field"><label htmlFor="weekly-time">每周报告（周一）</label><input defaultValue="09:30" id="weekly-time" type="time" /></div>
            </div>
          </section>
          <div id="rules"><RuleSettings /></div>
          <section className="settings-section" id="storage">
            <div className="settings-section__heading"><div><h2>文件清理</h2><p>分析结果长期保留，原视频和音频自动清理。</p></div></div>
            <div className="settings-grid"><div className="form-field"><label htmlFor="retention">视频与音频保留时间</label><select defaultValue="7" id="retention"><option value="3">3 天</option><option value="7">7 天</option><option value="14">14 天</option><option value="30">30 天</option></select></div></div>
          </section>
        </div>
      </div>
    </form>
  )
}
