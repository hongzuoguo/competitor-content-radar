import { useMemo, useState } from 'react'
import { AI_PROVIDER_CATALOG } from '../../../../services/ai/provider-catalog'
import type { AiProviderId } from '../../../../services/ai/provider-types'
import { StatusBadge } from '../../components/StatusBadge'

export function AiProviderSettings(): React.JSX.Element {
  const [providerId, setProviderId] = useState<AiProviderId>('qwen')
  const provider = useMemo(() => AI_PROVIDER_CATALOG.find((item) => item.id === providerId)!, [providerId])
  const recommended = provider.models.find((model) => model.recommended)?.id ?? ''
  const [modelByProvider, setModelByProvider] = useState<Record<string, string>>({ qwen: 'qwen3.7-plus' })
  const model = modelByProvider[providerId] ?? recommended

  function changeProvider(value: AiProviderId): void {
    const nextProvider = AI_PROVIDER_CATALOG.find((item) => item.id === value)!
    setProviderId(value)
    setModelByProvider((current) => ({ ...current, [value]: current[value] ?? nextProvider.models.find((item) => item.recommended)?.id ?? '' }))
  }

  return (
    <section className="settings-section" aria-labelledby="ai-settings-title">
      <div className="settings-section__heading"><div><h2 id="ai-settings-title">AI 拆解模型</h2><p>切换只影响之后的新任务，历史分析会保留原模型信息。</p></div><StatusBadge tone="success">已配置</StatusBadge></div>
      <div className="settings-grid">
        <div className="form-field"><label htmlFor="ai-provider">AI 提供商</label><select id="ai-provider" onChange={(event) => changeProvider(event.target.value as AiProviderId)} value={providerId}>{AI_PROVIDER_CATALOG.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
        <div className="form-field"><label htmlFor="ai-model">模型</label>{providerId === 'custom' ? <input id="ai-model" onChange={(event) => setModelByProvider((current) => ({ ...current, custom: event.target.value }))} placeholder="输入模型 ID" value={model} /> : <select id="ai-model" onChange={(event) => setModelByProvider((current) => ({ ...current, [providerId]: event.target.value }))} value={model}>{provider.models.map((item) => <option key={item.id} value={item.id}>{item.label}{item.recommended ? '（推荐）' : ''}</option>)}</select>}</div>
        {providerId === 'custom' ? <div className="form-field settings-grid__wide"><label htmlFor="base-url">接口地址</label><input id="base-url" placeholder="https://api.example.com/v1" type="url" /></div> : null}
        <div className="form-field settings-grid__wide"><label htmlFor="api-key">API Key</label><input autoComplete="off" id="api-key" placeholder="输入后将加密保存在本机" type="password" /><span className="form-help">凭证使用 Windows 安全存储加密，不会写入日志。</span></div>
      </div>
    </section>
  )
}
