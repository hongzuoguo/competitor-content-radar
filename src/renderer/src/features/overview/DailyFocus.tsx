import type { DashboardHighlight } from '../../../../shared/ipc-contract'

export function DailyFocus({ highlight, onSelect }: {
  highlight: DashboardHighlight | null
  onSelect(highlight: DashboardHighlight, trigger: HTMLButtonElement): void
}): React.JSX.Element {
  return <section className="daily-focus" aria-labelledby="daily-focus-title">
    <div className="daily-focus__heading">
      <div>
        <h2 id="daily-focus-title">今日重点</h2>
        <p>{highlight ? '当前「近 30 天爆款」排名第一，优先查看。' : '近 30 天暂无爆款可作为今日重点。'}</p>
      </div>
    </div>
    {highlight ? <button className="daily-focus__action" onClick={(event) => onSelect(highlight, event.currentTarget)} type="button">
      <span className="daily-focus__identity">
        <strong>{highlight.title}</strong>
        <span>{highlight.creatorName}</span>
      </span>
      <span className="daily-focus__metrics" aria-label="今日重点指标">
        <span><small>总点赞</small>{formatCompactNumber(highlight.likes)}</span>
        {highlight.relativePerformanceMultiplier !== null ? <span><small>相对表现</small>{highlight.relativePerformanceMultiplier}×</span> : null}
      </span>
      <span aria-hidden="true">查看详情</span>
    </button> : null}
  </section>
}

function formatCompactNumber(value: number): string {
  return value >= 10_000 ? `${Math.round(value / 1000) / 10}万` : value.toLocaleString('zh-CN')
}
