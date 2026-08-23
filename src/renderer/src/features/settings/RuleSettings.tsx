export function RuleSettings({
  absoluteLikes = 10_000,
  highCollects = 3_000,
  highComments = 500,
  highShares = 500,
  relativePerformanceSurgeMultiplier = 80,
  relativePerformanceMultiplier = 3
}: {
  absoluteLikes?: number
  highCollects?: number
  highComments?: number
  highShares?: number
  relativePerformanceSurgeMultiplier?: number
  relativePerformanceMultiplier?: number
}): React.JSX.Element {
  return <section className="settings-section" aria-labelledby="rule-settings-title">
    <div className="settings-section__heading"><div><h3 id="rule-settings-title">数据特征</h3><p>作品满足任意一项就进入爆款榜单，并在飞书「入选原因」中标出对应特征。</p></div></div>
    <div className="rule-list">
      <label><span><strong>绝对高点赞</strong><small>适合每条内容都稳定优秀的博主</small></span><span className="number-field"><input aria-label="绝对高点赞阈值" defaultValue={absoluteLikes} min="0" name="absoluteLikes" type="number" /> 点赞</span></label>
      <label><span><strong>高收藏</strong><small>作品收藏数超过该阈值时，飞书「入选原因」标「高收藏」</small></span><span className="number-field"><input aria-label="高收藏阈值" defaultValue={highCollects} min="0" name="highCollects" type="number" /> 收藏</span></label>
      <label><span><strong>高评论</strong><small>评论数超过该阈值时，飞书「入选原因」标「高评论」</small></span><span className="number-field"><input aria-label="高评论阈值" defaultValue={highComments} min="0" name="highComments" type="number" /> 评论</span></label>
      <label><span><strong>高转发</strong><small>分享数超过该阈值时，飞书「入选原因」标「高转发」</small></span><span className="number-field"><input aria-label="高转发阈值" defaultValue={highShares} min="0" name="highShares" type="number" /> 转发</span></label>
      <label><span><strong>相对表现突出</strong><small>互动量相对历史中位数 ≥ 该倍数时，飞书标「相对表现突出」（需至少 100 点赞）</small></span><span className="number-field"><input aria-label="相对表现突出倍数" defaultValue={relativePerformanceMultiplier} min="1" name="relativePerformanceMultiplier" step="0.1" type="number" /> 倍</span></label>
      <label><span><strong>相对表现暴增</strong><small>互动量相对历史中位数 ≥ 该倍数时，飞书标「相对表现暴增」</small></span><span className="number-field"><input aria-label="相对表现暴增倍数" defaultValue={relativePerformanceSurgeMultiplier} min="1" name="relativePerformanceSurgeMultiplier" type="number" /> 倍</span></label>
    </div>
  </section>
}
