import { useState } from 'react'

interface ContentSourceSettingsProps {
  contentSource?: 'douyin_browser' | 'get_biji'
  clientId?: string
  topicId?: string
  apiKeyConfigured?: boolean
}

export function ContentSourceSettings({
  contentSource = 'douyin_browser', clientId = '', topicId = '', apiKeyConfigured = false
}: ContentSourceSettingsProps): React.JSX.Element {
  const [source, setSource] = useState(contentSource)

  return (
    <section className="settings-section" aria-labelledby="content-source-title">
      <div className="settings-section__heading"><div>
        <h2 id="content-source-title">内容采集源</h2>
        <p>推荐由得到大脑同步订阅博主和文字稿，本应用继续负责爆款判断与 AI 拆解。</p>
      </div></div>
      <div className="settings-grid">
        <div className="form-field settings-grid__wide">
          <label htmlFor="content-source">采集方式</label>
          <select id="content-source" name="contentSource" value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
            <option value="get_biji">得到大脑 OpenAPI（推荐）</option>
            <option value="douyin_browser">本机抖音浏览器（兼容模式）</option>
          </select>
        </div>
        {source === 'get_biji' ? <>
          <div className="form-field">
            <label htmlFor="get-biji-topic-id">知识库专题 ID</label>
            <input defaultValue={topicId} id="get-biji-topic-id" name="getBijiTopicId" placeholder="例如 Y2m4oeAn" required />
          </div>
          <div className="form-field">
            <label htmlFor="get-biji-client-id">Client ID</label>
            <input autoComplete="off" defaultValue={clientId} id="get-biji-client-id" name="getBijiClientId" placeholder="cli_xxxxx" required />
          </div>
          <div className="form-field settings-grid__wide">
            <label htmlFor="get-biji-api-key">得到大脑 API Key</label>
            <input autoComplete="new-password" id="get-biji-api-key" name="getBijiApiKey" placeholder={apiKeyConfigured ? '已安全保存；不修改可留空' : 'gk_live_xxxxx'} type="password" />
            <small>需为应用开通 topic.blogger.read 权限。订阅博主仍在得到大脑中添加，保存后点击“立即运行”同步。</small>
          </div>
        </> : <div className="form-field settings-grid__wide">
          <small>兼容模式依赖抖音网页登录和安全验证，可能因平台风控暂时无法采集。</small>
        </div>}
      </div>
    </section>
  )
}
