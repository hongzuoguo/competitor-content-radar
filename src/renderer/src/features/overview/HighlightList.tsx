import { ChevronRight, Heart, Sparkles, TrendingUp } from 'lucide-react'
import type { DashboardHighlight } from '../../../../shared/ipc-contract'

export const REASON_LABELS = {
  absolute_high_likes: '高点赞',
  relative_viral: '相对爆款',
  high_reference_value: 'AI 高借鉴'
} as const

export function HighlightList({
  highlights,
  onSelect
}: {
  highlights: DashboardHighlight[]
  onSelect(highlight: DashboardHighlight): void
}): React.JSX.Element {
  return (
    <div className="highlight-list">
      {highlights.map((highlight) => (
        <button
          className="highlight-row"
          key={highlight.id}
          onClick={() => onSelect(highlight)}
          type="button"
        >
          <span className="highlight-row__identity">
            <span className="highlight-row__creator">{highlight.creatorName}</span>
            <strong>{highlight.title}</strong>
          </span>
          <span className="highlight-row__reasons">
            {highlight.reasons.map((reason) => <span key={reason}>{REASON_LABELS[reason]}</span>)}
          </span>
          <span className="highlight-row__metrics" aria-label="作品关键指标">
            <span title="点赞量"><Heart size={14} />{highlight.likes.toLocaleString('zh-CN')}</span>
            {highlight.relativeViralIndex !== null ? <span title="相对爆款指数"><TrendingUp size={14} />{highlight.relativeViralIndex}</span> : null}
            {highlight.referenceValueScore !== null ? <span title="借鉴价值评分"><Sparkles size={14} />{highlight.referenceValueScore}</span> : null}
          </span>
          <ChevronRight className="highlight-row__arrow" size={17} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
