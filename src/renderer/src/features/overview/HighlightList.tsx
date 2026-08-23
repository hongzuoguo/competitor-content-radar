import { ChevronRight } from 'lucide-react'
import type { DashboardHighlight } from '../../../../shared/ipc-contract'
import type { RadarStatus } from '../../../../core/radar-status'

export const REASON_LABELS = {
  absolute_high_likes: '绝对高点赞',
  high_collects: '高收藏',
  high_comments: '高评论',
  high_shares: '高转发',
  relative_performance_surge: '相对表现暴增',
  relative_performance: '相对表现突出'
} as const

export const RADAR_STATUS_LABELS: Record<RadarStatus, string> = {
  newly_viral: '新晋爆款',
  warming: '持续升温',
  cooling: '热度回落',
  strong: '高位稳定',
  watching: '持续观察'
}

export function HighlightList({ highlights, onSelect }: {
  highlights: DashboardHighlight[]
  onSelect(highlight: DashboardHighlight, trigger: HTMLButtonElement): void
}): React.JSX.Element {
  return <div className="highlight-list">
    {highlights.map((highlight, index) => <button
      className="highlight-row"
      key={highlight.id}
      onClick={(event) => onSelect(highlight, event.currentTarget)}
      type="button"
    >
      <span className="highlight-row__rank">{index + 1}</span>
      <span className="highlight-row__identity">
        <span className="highlight-row__title-line">
          <strong>{highlight.title}</strong>
          {highlight.radarStatus && highlight.radarStatus !== 'watching' ? <span className={`radar-status radar-status--${highlight.radarStatus}`}>{RADAR_STATUS_LABELS[highlight.radarStatus]}</span> : null}
        </span>
        <span className="highlight-row__creator">{highlight.creatorName}</span>
      </span>
      <span className="highlight-row__metrics" aria-label="作品关键指标">
        <span><small>总点赞</small>{formatCompactNumber(highlight.likes)}</span>
        {highlight.relativePerformanceMultiplier !== null ? <span><small>相对表现</small>{highlight.relativePerformanceMultiplier}×</span> : null}
      </span>
      <ChevronRight className="highlight-row__arrow" size={17} aria-hidden="true" />
    </button>)}
  </div>
}

function formatCompactNumber(value: number): string {
  return value >= 10_000 ? `${Math.round(value / 1000) / 10}万` : value.toLocaleString('zh-CN')
}
