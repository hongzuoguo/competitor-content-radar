import { useEffect, useState } from 'react'
import type { AgentReasoningEffort } from '../../../../shared/ipc-contract'

interface AgentSettingsProps {
  supported: boolean
}

export function AgentSettings(props: AgentSettingsProps): React.JSX.Element {
  const api = window.desktopApi
  const [agentModel, setAgentModel] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState<AgentReasoningEffort | ''>('')

  useEffect(() => {
    api?.getSettings().then((settings) => {
      setAgentModel(settings.agentModel ?? '')
      setReasoningEffort(settings.agentReasoningEffort ?? '')
    }).catch(() => {
      setAgentModel('')
      setReasoningEffort('')
    })
  }, [api])

  async function updateAgentModel(value: string): Promise<void> {
    const model = value.trim()
    setAgentModel(model)
    try {
      await api?.saveSettings({ agentModel: model || undefined })
      window.dispatchEvent(new Event('content-radar:engine-health-changed'))
    } catch { /* persistence is best-effort */ }
  }

  async function updateReasoningEffort(value: AgentReasoningEffort | ''): Promise<void> {
    setReasoningEffort(value)
    try {
      await api?.saveSettings({ agentReasoningEffort: value || undefined })
      window.dispatchEvent(new Event('content-radar:engine-health-changed'))
    } catch { /* persistence is best-effort */ }
  }

  if (!props.supported) return <></>

  return (
    <section className="settings-section" id="local-agent">
      <div className="settings-section__heading">
        <div>
          <h3>本地 Codex</h3>
          <p>安装并登录 Codex CLI 后即可自动拆解；不要求安装 Codex 桌面版。</p>
        </div>
      </div>
      <div className="settings-grid">
        <div className="settings-grid__wide agent-model-grid">
          <div className="agent-model-field">
            <label htmlFor="agent-model-input">Codex 模型（可选）</label>
            <input
              id="agent-model-input"
              type="text"
              placeholder="例如：gpt-5.6-luna"
              value={agentModel}
              onChange={(event) => void updateAgentModel(event.target.value)}
            />
            <p className="form-help">填写 Codex 模型 ID，例如 gpt-5.6-luna；留空则使用 Codex 当前默认模型。</p>
          </div>
          <div className="agent-model-field">
            <label htmlFor="agent-reasoning-effort">推理强度（可选）</label>
            <select
              id="agent-reasoning-effort"
              value={reasoningEffort}
              onChange={(event) => void updateReasoningEffort(event.target.value as AgentReasoningEffort | '')}
            >
              <option value="">使用 Codex 默认设置</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="xhigh">极高</option>
              <option value="max">最大</option>
            </select>
            <p className="form-help">推理强度不写在模型 ID 中。</p>
          </div>
        </div>
        <p className="settings-grid__wide form-help">可执行诊断会在统一刷新状态时一起验证。</p>
      </div>
    </section>
  )
}
