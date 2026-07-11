import { ChevronRight } from 'lucide-react'
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
  onSelect(highlight: DashboardHighlight, trigger: HTMLButtonElement): void
}): React.JSX.Element {
  const publishLabel = (publishedAt: string): string => {
    const published = new Date(publishedAt)
    const now = new Date()
    const sameDay = published.getFullYear() === now.getFullYear() && published.getMonth() === now.getMonth() && published.getDate() === now.getDate()
    return `${sameDay ? '今天' : published.toLocaleDateString('zh-CN')} ${published.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  }
  return (
    <div className="highlight-list">
      {highlights.map((highlight) => (
        <button
          className="highlight-row"
          key={highlight.id}
          onClick={(event) => onSelect(highlight, event.currentTarget)}
          type="button"
        >
          <span className="highlight-row__identity">
            <span className="highlight-row__creator">{highlight.creatorName} · {publishLabel(highlight.publishedAt)}</span>
            <strong>{highlight.title}</strong>
            <span className="highlight-row__reasons">
              {highlight.reasons.map((reason) => <span key={reason}>{REASON_LABELS[reason]}</span>)}
            </span>
          </span>
          <span className="highlight-row__metrics" aria-label="作品关键指标">
            <span><small>赞</small>{highlight.likes.toLocaleString('zh-CN')}</span>
            {highlight.relativeViralIndex !== null ? <span><small>相对</small>{highlight.relativeViralIndex}%</span> : null}
            {highlight.referenceValueScore !== null ? <span><small>借鉴</small>{highlight.referenceValueScore}/100</span> : null}
          </span>
          <ChevronRight className="highlight-row__arrow" size={17} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
