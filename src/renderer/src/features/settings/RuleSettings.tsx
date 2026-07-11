import { useState } from 'react'

export function RuleSettings(): React.JSX.Element {
  const [likes, setLikes] = useState(10_000)
  return (
    <section className="settings-section" aria-labelledby="rule-settings-title">
      <div className="settings-section__heading"><div><h2 id="rule-settings-title">今日重点判断</h2><p>作品满足任意一项就进入今日重点。</p></div></div>
      <div className="rule-list">
        <label><span><strong>绝对高点赞</strong><small>适合每条内容都稳定优秀的博主</small></span><span className="number-field"><input aria-label="绝对高点赞阈值" min="0" onChange={(event) => setLikes(Number(event.target.value))} type="number" value={likes} /> 点赞</span></label>
        <label><span><strong>相对爆款指数</strong><small>至少 5 条历史样本，基于最近 30 条中位数</small></span><span className="number-field"><input aria-label="相对爆款指数阈值" defaultValue="150" min="100" type="number" /> 指数</span></label>
        <label><span><strong>AI 借鉴价值</strong><small>综合结构清晰度、可迁移性和差异化空间</small></span><span className="number-field"><input aria-label="借鉴价值阈值" defaultValue="80" max="100" min="0" type="number" /> 分</span></label>
      </div>
    </section>
  )
}
