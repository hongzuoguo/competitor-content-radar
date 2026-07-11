import { ArrowLeft, ArrowRight, Check, ExternalLink, Radar } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AI_PROVIDER_CATALOG } from '../../../../services/ai/provider-catalog'
import type { AiProviderId } from '../../../../services/ai/provider-types'
import { Button } from '../../components/Button'
import './setup-wizard.css'

const STEPS = ['抖音登录', 'AI 模型', '飞书同步', '添加博主', '自动运行'] as const

export function SetupWizard({
  onComplete,
  onLogin = async () => undefined,
  onAuthorizeFeishu = async () => undefined
}: {
  onComplete(): void
  onLogin?: () => Promise<void>
  onAuthorizeFeishu?: () => Promise<void>
}): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [providerId, setProviderId] = useState<AiProviderId>('qwen')
  const provider = useMemo(() => AI_PROVIDER_CATALOG.find((item) => item.id === providerId)!, [providerId])
  const [creatorUrl, setCreatorUrl] = useState('')
  const [creatorError, setCreatorError] = useState('')

  function addCreator(): void {
    if (!/^https:\/\/(www\.)?douyin\.com\/user\/[^/?]+/.test(creatorUrl.trim())) {
      setCreatorError('请粘贴完整的抖音博主主页地址')
      return
    }
    setCreatorError('')
    setStep(4)
  }

  return (
    <div className="setup-shell">
      <aside className="setup-aside">
        <div className="setup-brand"><span><Radar size={19} /></span>对标内容雷达</div>
        <div><p>首次设置</p><h1>五步完成自动内容监控</h1><span>大约需要 3 分钟。所有配置之后都可以在设置中修改。</span></div>
        <ol>{STEPS.map((label, index) => <li data-state={index < step ? 'complete' : index === step ? 'current' : 'pending'} key={label}><span>{index < step ? <Check size={14} /> : index + 1}</span>{label}</li>)}</ol>
        <small>凭证加密保存在当前 Windows 账户中。</small>
      </aside>
      <main className="setup-main">
        <div className="setup-step">
          {step === 0 ? <>
            <span className="setup-kicker">第 1 步，共 5 步</span><h2>连接抖音账号</h2><p>应用会打开独立登录窗口。你只需扫码登录一次，后续使用持久会话采集公开作品。</p>
            <div className="setup-note">遇到验证码或风险验证时，需要你在抖音窗口手动完成；应用不会尝试绕过。</div>
            <div className="setup-actions"><Button icon={<ExternalLink size={16} />} onClick={() => void onLogin()} variant="secondary">打开抖音登录窗口</Button><Button icon={<ArrowRight size={16} />} onClick={() => setStep(1)}>我已完成登录</Button></div>
          </> : null}
          {step === 1 ? <>
            <span className="setup-kicker">第 2 步，共 5 步</span><h2>选择 AI 拆解模型</h2><p>模型负责选题、钩子、结构、爆点和差异化创作建议。本地转写会自动完成，无需额外设置。</p>
            <div className="setup-form-grid"><div className="form-field"><label htmlFor="setup-provider">AI 提供商</label><select id="setup-provider" onChange={(event) => setProviderId(event.target.value as AiProviderId)} value={providerId}>{AI_PROVIDER_CATALOG.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div><div className="form-field"><label htmlFor="setup-model">模型</label><select id="setup-model" defaultValue={provider.models.find((item) => item.recommended)?.id}>{provider.models.map((model) => <option key={model.id} value={model.id}>{model.label}{model.recommended ? '（推荐）' : ''}</option>)}</select></div><div className="form-field setup-form-wide"><label htmlFor="setup-key">API Key</label><input id="setup-key" placeholder="输入后加密保存在本机" type="password" /></div></div>
            <div className="setup-actions"><Button icon={<ArrowLeft size={16} />} onClick={() => setStep(0)} variant="ghost">上一步</Button><Button icon={<ArrowRight size={16} />} onClick={() => setStep(2)}>保存并继续</Button></div>
          </> : null}
          {step === 2 ? <>
            <span className="setup-kicker">第 3 步，共 5 步</span><h2>连接飞书</h2><p>授权后自动创建“对标内容雷达”多维表格，以及博主、作品分析、每日指标快照和报告四张关联表。</p>
            <div className="setup-note">飞书可以稍后再连接。本地采集、转写和分析不会受到影响。</div>
            <div className="setup-actions"><Button onClick={() => setStep(3)} variant="ghost">暂时跳过飞书</Button><Button icon={<ExternalLink size={16} />} onClick={() => void onAuthorizeFeishu().then(() => setStep(3))}>授权并继续</Button></div>
          </> : null}
          {step === 3 ? <>
            <span className="setup-kicker">第 4 步，共 5 步</span><h2>添加第一个对标博主</h2><p>粘贴抖音博主主页。首次采集最近 30 条作品作为基线，只下载和分析最近 120 小时的作品。</p>
            <div className="form-field"><label htmlFor="first-creator">第一个博主主页</label><input aria-describedby={creatorError ? 'first-creator-error' : undefined} id="first-creator" onChange={(event) => setCreatorUrl(event.target.value)} placeholder="https://www.douyin.com/user/..." type="url" value={creatorUrl} />{creatorError ? <span className="form-error" id="first-creator-error">{creatorError}</span> : null}</div>
            <div className="setup-actions"><Button onClick={() => setStep(2)} variant="ghost">上一步</Button><Button icon={<ArrowRight size={16} />} onClick={addCreator}>添加并继续</Button></div>
          </> : null}
          {step === 4 ? <>
            <span className="setup-kicker">第 5 步，共 5 步</span><h2>确认自动运行时间</h2><p>每日采集和每周报告只在电脑开机时运行；错过计划后，下次启动会补跑一次。</p>
            <div className="setup-form-grid"><div className="form-field"><label htmlFor="setup-daily">每日监控</label><input defaultValue="09:00" id="setup-daily" type="time" /></div><div className="form-field"><label htmlFor="setup-weekly">周一报告</label><input defaultValue="09:30" id="setup-weekly" type="time" /></div></div>
            <div className="setup-note">“今日重点”默认标准：点赞 ≥ 10,000、相对爆款指数 ≥ 150 或 AI 借鉴评分 ≥ 80。</div>
            <div className="setup-actions"><Button onClick={() => setStep(3)} variant="ghost">上一步</Button><Button icon={<Check size={16} />} onClick={onComplete}>完成设置</Button></div>
          </> : null}
        </div>
      </main>
    </div>
  )
}
