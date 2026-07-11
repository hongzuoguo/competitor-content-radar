import type { HighlightReason } from './highlight-rules'

export interface ReportableWork {
  likes: number
  comments: number
  shares: number
  collects: number
  highlightReasons: HighlightReason[]
}

export interface ReportSummary {
  works: number
  highlights: number
  likes: number
  comments: number
  shares: number
  collects: number
  engagement: number
}

export function buildReportSummary(works: readonly ReportableWork[]): ReportSummary {
  return works.reduce<ReportSummary>(
    (summary, work) => {
      summary.works += 1
      if (work.highlightReasons.length > 0) summary.highlights += 1
      summary.likes += work.likes
      summary.comments += work.comments
      summary.shares += work.shares
      summary.collects += work.collects
      summary.engagement += work.likes + work.comments + work.shares + work.collects
      return summary
    },
    { works: 0, highlights: 0, likes: 0, comments: 0, shares: 0, collects: 0, engagement: 0 }
  )
}
