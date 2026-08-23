import { CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  ConnectionTestResult,
  ModelProfileDraft,
  ModelProfileView
} from '../../../../shared/ipc-contract'
import { AI_PROVIDER_CATALOG } from '../../../../services/ai/provider-catalog'
import type { ProviderTemplate } from '../../../../services/ai/model-profile'
import { Button } from '../../components/Button'

interface ProfileDraftState {
  name: string
  providerTemplate: ProviderTemplate
  baseUrl: string
  modelId: string
  apiKey: string
  requiresApiKey: boolean
  enabled: boolean
}

const EMPTY_DRAFT: ProfileDraftState = {
  name: '',
  providerTemplate: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  modelId: '',
  apiKey: '',
  requiresApiKey: true,
  enabled: true
}

export function ModelProfileSettings(): React.JSX.Element {
  const api = window.desktopApi
  const supported = Boolean(api && typeof api.listModelProfiles === 'function')
  const [profiles, setProfiles] = useState<ModelProfileView[]>([])
  const [loading, setLoading] = useState(supported)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [draft, setDraft] = useState<ProfileDraftState>(EMPTY_DRAFT)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)

  useEffect(() => {
    if (!supported) return
    let cancelled = false
    void api.listModelProfiles()
      .then((items) => { if (!cancelled) setProfiles(items) })
      .catch(() => { if (!cancelled) setMessage('模型配置读取失败，请重新打开设置页。') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [api, supported])

  const editingProfile = useMemo(
    () => profiles.find((profile) => profile.id === editingId) ?? null,
    [editingId, profiles]
  )

  function beginCreate(): void {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setMessage('')
    setTestResult(null)
    setShowEditor(true)
  }

  function beginEdit(profile: ModelProfileView): void {
    setEditingId(profile.id)
    setDraft({
      name: profile.name,
      providerTemplate: profile.providerTemplate,
      baseUrl: profile.baseUrl,
      modelId: profile.modelId,
      apiKey: '',
      requiresApiKey: profile.requiresApiKey,
      enabled: profile.enabled
    })
    setMessage('')
    setTestResult(null)
    setShowEditor(true)
  }

  function changeProvider(providerTemplate: ProviderTemplate): void {
    const currentTemplate = AI_PROVIDER_CATALOG.find((provider) => provider.id === draft.providerTemplate)
    const nextTemplate = AI_PROVIDER_CATALOG.find((provider) => provider.id === providerTemplate)
    const mayReplaceBaseUrl = !draft.baseUrl || draft.baseUrl === currentTemplate?.baseUrl
    setDraft((current) => ({
      ...current,
      providerTemplate,
      baseUrl: mayReplaceBaseUrl ? (nextTemplate?.baseUrl ?? '') : current.baseUrl
    }))
    setTestResult(null)
  }

  function openProviderDocumentation(): void {
    const docsUrl = AI_PROVIDER_CATALOG.find((provider) => provider.id === draft.providerTemplate)?.docsUrl
    if (docsUrl && typeof api.openExternal === 'function') void api.openExternal(docsUrl)
  }

  function payload(): ModelProfileDraft | null {
    const value: ModelProfileDraft = {
      name: draft.name.trim(),
      providerTemplate: draft.providerTemplate,
      baseUrl: draft.baseUrl.trim(),
      modelId: draft.modelId.trim(),
      requiresApiKey: draft.requiresApiKey,
      enabled: draft.enabled,
      ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {})
    }
    if (!value.name) {
      setMessage('请输入配置名称。')
      return null
    }
    if (!value.modelId) {
      setMessage('请输入模型 ID。')
      return null
    }
    if (!value.baseUrl) {
      setMessage('请输入 API 地址。')
      return null
    }
    return value
  }

  async function saveProfile(): Promise<void> {
    const value = payload()
    if (!value || busy) return
    setBusy('save')
    setMessage('正在保存模型配置…')
    try {
      const saved = editingId
        ? await api.updateModelProfile(editingId, value)
        : await api.createModelProfile(value)
      setProfiles((current) => editingId
        ? current.map((profile) => profile.id === saved.id ? saved : profile)
        : [...current.map((profile) => saved.active ? { ...profile, active: false } : profile), saved])
      setDraft((current) => ({ ...current, apiKey: '' }))
      setEditingId(saved.id)
      setShowEditor(false)
      setMessage('模型配置已保存。')
      setTestResult(null)
      window.dispatchEvent(new Event('content-radar:engine-health-changed'))
    } catch (error) {
      setMessage(modelProfileError(error))
    } finally {
      setBusy('')
    }
  }

  async function testConnection(): Promise<void> {
    const value = payload()
    if (!value || busy) return
    setBusy('test')
    setMessage('')
    setTestResult(null)
    try {
      const result = await api.testModelProfile({ ...value, ...(editingId ? { profileId: editingId } : {}) })
      setTestResult(result)
    } catch (error) {
      setTestResult({ executed: false, ok: false, message: modelProfileError(error) })
    } finally {
      setBusy('')
    }
  }

  async function activate(profile: ModelProfileView): Promise<void> {
    if (busy || profile.active) return
    setBusy(`activate:${profile.id}`)
    setMessage('正在切换当前模型…')
    try {
      const activated = await api.activateModelProfile(profile.id)
      setProfiles((current) => current.map((item) => ({
        ...item,
        active: item.id === profile.id,
        ...(item.id === profile.id && activated ? activated : {})
      })))
      setMessage(`已切换到“${profile.name}”。`)
      window.dispatchEvent(new Event('content-radar:engine-health-changed'))
    } catch (error) {
      setMessage(modelProfileError(error))
    } finally {
      setBusy('')
    }
  }

  async function deleteProfile(profile: ModelProfileView): Promise<void> {
    if (busy || profile.active) return
    setBusy(`delete:${profile.id}`)
    setMessage('正在删除模型配置…')
    try {
      await api.deleteModelProfile(profile.id)
      setProfiles((current) => current.filter((item) => item.id !== profile.id))
      if (editingId === profile.id) {
        setEditingId(null)
        setShowEditor(false)
      }
      setMessage('模型配置已删除。')
      window.dispatchEvent(new Event('content-radar:engine-health-changed'))
    } catch (error) {
      setMessage(modelProfileError(error))
    } finally {
      setBusy('')
    }
  }

  async function deleteSavedKey(): Promise<void> {
    if (!editingProfile || busy) return
    setBusy('delete-key')
    try {
      await api.deleteModelProfileKey(editingProfile.id)
      setProfiles((current) => current.map((profile) => profile.id === editingProfile.id
        ? { ...profile, apiKeyConfigured: false }
        : profile))
      setMessage('已删除保存的 API Key。')
      window.dispatchEvent(new Event('content-radar:engine-health-changed'))
    } catch (error) {
      setMessage(modelProfileError(error))
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="settings-section model-profiles" aria-labelledby="model-profiles-title">
      <div className="settings-section__heading">
        <div>
          <h3 id="model-profiles-title">AI 拆解模型</h3>
          <p>模型 ID 可自由填写；服务商模板只负责预填兼容地址。密钥仅保存在本机，不会显示在页面或写入日志。</p>
        </div>
        <Button aria-label="新建模型配置" icon={<Plus size={16} />} onClick={beginCreate} variant="secondary">模型配置</Button>
      </div>

      {!supported && <p className="model-profiles__notice">当前版本暂不支持模型配置管理，请更新应用后重试。</p>}
      {supported && loading && <p className="model-profiles__notice">正在读取模型配置…</p>}
      {supported && !loading && profiles.length === 0 && !showEditor && (
        <div className="model-profiles__empty">
          <strong>还没有模型配置</strong>
          <span>新建一个 OpenAI 兼容配置后，AI 拆解才会运行。</span>
        </div>
      )}

      {profiles.length > 0 && (
        <div className="model-profile-list">
          {profiles.map((profile) => (
            <article className="model-profile-row" data-active={profile.active} key={profile.id}>
              <div className="model-profile-row__identity">
                <div className="model-profile-row__title">
                  <strong>{profile.name}</strong>
                  {profile.active && <span className="status-badge" data-tone="success"><CheckCircle2 size={13} />当前配置</span>}
                  {!profile.enabled && <span className="status-badge" data-tone="neutral">已停用</span>}
                </div>
                <span>{providerLabel(profile.providerTemplate)} · {profile.modelId}</span>
                <small title={profile.baseUrl}>{profile.baseUrl}</small>
              </div>
              <div className="model-profile-row__status">
                <span>{profile.requiresApiKey
                  ? (profile.apiKeyConfigured ? '已安全保存' : '未保存 API Key')
                  : '无需 API Key'}</span>
              </div>
              <div className="model-profile-row__actions">
                {!profile.active && profile.enabled && (
                  <Button disabled={Boolean(busy)} onClick={() => void activate(profile)} variant="secondary">设为当前</Button>
                )}
                <Button icon={<Pencil size={15} />} disabled={Boolean(busy)} onClick={() => beginEdit(profile)} variant="ghost">编辑</Button>
                <Button
                  aria-label={profile.active ? '删除当前配置' : `删除${profile.name}`}
                  disabled={Boolean(busy) || profile.active}
                  icon={<Trash2 size={15} />}
                  onClick={() => void deleteProfile(profile)}
                  variant="ghost"
                >删除</Button>
              </div>
            </article>
          ))}
        </div>
      )}

      {showEditor && (
        <div className="model-profile-editor" aria-label={editingId ? '编辑模型配置' : '新建模型配置'}>
          <div className="model-profile-editor__heading">
            <div>
              <h3>{editingId ? '编辑模型配置' : '新建模型配置'}</h3>
              <p>{editingId && editingProfile?.apiKeyConfigured ? 'API Key 已安全保存；留空不会更改。' : '填写模型服务商提供的兼容参数。'}</p>
            </div>
            {editingProfile?.apiKeyConfigured && (
              <Button disabled={Boolean(busy)} onClick={() => void deleteSavedKey()} variant="danger">删除已保存密钥</Button>
            )}
          </div>
          <div className="settings-grid model-profile-editor__grid">
            <div className="form-field">
              <label htmlFor="model-profile-name">配置名称</label>
              <input id="model-profile-name" maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如:工作 DeepSeek / 备用 GPT" value={draft.name} />
              <small>用于在多个模型配置中区分这一个；留空保存时会自动命名。</small>
            </div>
            <div className="form-field">
              <label htmlFor="model-profile-provider">服务商模板</label>
              <select id="model-profile-provider" onChange={(event) => changeProvider(event.target.value as ProviderTemplate)} value={draft.providerTemplate}>
                {AI_PROVIDER_CATALOG.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
              </select>
              <small>
                模板仅预填 API 地址，不限制你填写的模型。
                {AI_PROVIDER_CATALOG.find((provider) => provider.id === draft.providerTemplate)?.docsUrl && (
                  <button className="model-profile-editor__docs" onClick={openProviderDocumentation} type="button">查看配置文档</button>
                )}
              </small>
            </div>
            <div className="form-field">
              <label htmlFor="model-profile-model-id">模型 ID</label>
              <input id="model-profile-model-id" maxLength={160} onChange={(event) => setDraft({ ...draft, modelId: event.target.value })} placeholder="例如 deepseek-v4-flash" value={draft.modelId} />
            </div>
            <div className="form-field">
              <label htmlFor="model-profile-base-url">API 地址</label>
              <input id="model-profile-base-url" onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" value={draft.baseUrl} />
            </div>
            <div className="form-field settings-grid__wide">
              <label htmlFor="model-profile-api-key">API Key</label>
              <input autoComplete="new-password" id="model-profile-api-key" onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={editingProfile?.apiKeyConfigured ? '留空保留当前密钥' : '仅保存在这台电脑'} type="password" value={draft.apiKey} />
            </div>
          </div>
          <div className="model-profile-editor__options">
            <label><input checked={draft.requiresApiKey} onChange={(event) => setDraft({ ...draft, requiresApiKey: event.target.checked, apiKey: event.target.checked ? draft.apiKey : '' })} type="checkbox" />此接口需要 API Key</label>
            <label><input checked={draft.enabled} disabled={editingProfile?.active} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} type="checkbox" />启用此配置</label>
          </div>
          <div className="model-profile-editor__footer">
            <div aria-live="polite" className="model-profile-editor__result" data-ok={testResult?.ok || undefined}>
              {testResult && (testResult.ok ? '连接成功，可以保存使用。' : (testResult.message || '连接失败，请检查 API 地址、模型 ID 和密钥。'))}
            </div>
            <div>
              <Button disabled={Boolean(busy)} onClick={() => { setShowEditor(false); setTestResult(null); setMessage('') }} variant="ghost">取消</Button>
              <Button disabled={Boolean(busy)} onClick={() => void testConnection()} variant="secondary">{busy === 'test' ? '正在测试…' : '测试连接'}</Button>
              <Button disabled={Boolean(busy)} onClick={() => void saveProfile()}>{busy === 'save' ? '正在保存…' : '保存配置'}</Button>
            </div>
          </div>
        </div>
      )}
      <p aria-live="polite" className="form-help model-profiles__message">{message}</p>
    </section>
  )
}

function providerLabel(providerTemplate: ProviderTemplate): string {
  return AI_PROVIDER_CATALOG.find((provider) => provider.id === providerTemplate)?.label ?? '自定义兼容接口'
}

function modelProfileError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('ACTIVE_DISABLE_FORBIDDEN')) return '当前配置不能停用，请先切换到其他配置。'
  if (message.includes('ACTIVE_DELETE_FORBIDDEN')) return '当前配置不能删除，请先切换到其他配置。'
  if (message.includes('API_KEY')) return 'API Key 不可用，请检查后重试。'
  if (message.includes('INVALID_MODEL_PROFILE')) return '配置格式不正确，请检查名称、模型 ID 和 API 地址。'
  return '操作未完成，请检查配置和网络后重试。'
}
