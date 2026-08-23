import type { EngagementMetrics } from './domain'

export const HIGHLIGHT_THRESHOLDS = {
  absoluteLikes: 10_000,
  highCollects: 3_000,
  highComments: 500,
  highShares: 500,
  relativePerformanceSurgeMultiplier: 80,
  relativePerformanceMultiplier: 3,
  minimumRelativeLikes: 100,
  minimumBaselineWorks: 5,
  maximumBaselineWorks: 30
} as const

export type HighlightReason =
  | 'absolute_high_likes'
  | 'high_collects'
  | 'high_comments'
  | 'high_shares'
  | 'relative_performance_surge'
  | 'relative_performance'

export interface HighlightEvaluation {
  isHighlight: boolean
  reasons: HighlightReason[]
  relativePerformanceMultiplier: number | null
}

export interface HighlightThresholdOverrides {
  absoluteLikes?: number
  highCollects?: number
  highComments?: number
  highShares?: number
  relativePerformanceSurgeMultiplier?: number
  relativePerformanceMultiplier?: number
  minimumRelativeLikes?: number
}

export function calculateEngagement(metrics: EngagementMetrics): number {
  return metrics.likes + metrics.comments + metrics.shares + metrics.collects
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

export function calculateRelativePerformance(
  current: EngagementMetrics,
  recentHistoricalEngagement: readonly number[]
): number | null {
  const baseline = recentHistoricalEngagement.slice(0, HIGHLIGHT_THRESHOLDS.maximumBaselineWorks)
  if (baseline.length < HIGHLIGHT_THRESHOLDS.minimumBaselineWorks) return null

  const historicalMedian = median(baseline)
  if (historicalMedian <= 0) return null

  return Math.round((calculateEngagement(current) / historicalMedian) * 10) / 10
}

export function evaluateHighlight(
  current: EngagementMetrics,
  recentHistoricalEngagement: readonly number[],
  thresholds: HighlightThresholdOverrides = {}
): HighlightEvaluation {
  const reasons: HighlightReason[] = []
  const relativePerformanceMultiplier = calculateRelativePerformance(current, recentHistoricalEngagement)

  // 绝对高点赞：点赞数达到阈值
  if (current.likes >= (thresholds.absoluteLikes ?? HIGHLIGHT_THRESHOLDS.absoluteLikes)) reasons.push('absolute_high_likes')
  // 高收藏：收藏数达到阈值
  if ((current.collects ?? 0) >= (thresholds.highCollects ?? HIGHLIGHT_THRESHOLDS.highCollects)) reasons.push('high_collects')
  // 高评论：评论数达到阈值
  if ((current.comments ?? 0) >= (thresholds.highComments ?? HIGHLIGHT_THRESHOLDS.highComments)) reasons.push('high_comments')
  // 高转发：分享数达到阈值
  if ((current.shares ?? 0) >= (thresholds.highShares ?? HIGHLIGHT_THRESHOLDS.highShares)) reasons.push('high_shares')
  // 相对表现暴增：互动量达到历史中位数的高倍数
  if (relativePerformanceMultiplier !== null && relativePerformanceMultiplier >= (thresholds.relativePerformanceSurgeMultiplier ?? HIGHLIGHT_THRESHOLDS.relativePerformanceSurgeMultiplier)) {
    reasons.push('relative_performance_surge')
  } else if (
    relativePerformanceMultiplier !== null &&
    relativePerformanceMultiplier >= (thresholds.relativePerformanceMultiplier ?? HIGHLIGHT_THRESHOLDS.relativePerformanceMultiplier) &&
    current.likes >= (thresholds.minimumRelativeLikes ?? HIGHLIGHT_THRESHOLDS.minimumRelativeLikes)
  ) {
    reasons.push('relative_performance')
  }

  return { isHighlight: reasons.length > 0, reasons, relativePerformanceMultiplier }
}
