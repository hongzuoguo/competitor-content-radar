import type { EngagementMetrics } from './domain'

export const HIGHLIGHT_THRESHOLDS = {
  absoluteLikes: 10_000,
  relativeViralIndex: 150,
  referenceValueScore: 80,
  minimumBaselineWorks: 5,
  maximumBaselineWorks: 30
} as const

export type HighlightReason =
  | 'absolute_high_likes'
  | 'relative_viral'
  | 'high_reference_value'

export interface HighlightEvaluation {
  isHighlight: boolean
  reasons: HighlightReason[]
  relativeViralIndex: number | null
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

export function calculateRelativeViralIndex(
  current: EngagementMetrics,
  recentHistoricalEngagement: readonly number[]
): number | null {
  const baseline = recentHistoricalEngagement.slice(0, HIGHLIGHT_THRESHOLDS.maximumBaselineWorks)
  if (baseline.length < HIGHLIGHT_THRESHOLDS.minimumBaselineWorks) return null

  const historicalMedian = median(baseline)
  if (historicalMedian <= 0) return null

  return Math.round((calculateEngagement(current) / historicalMedian) * 1000) / 10
}

export function evaluateHighlight(
  current: EngagementMetrics,
  recentHistoricalEngagement: readonly number[],
  referenceValueScore: number | null
): HighlightEvaluation {
  const reasons: HighlightReason[] = []
  const relativeViralIndex = calculateRelativeViralIndex(current, recentHistoricalEngagement)

  if (current.likes >= HIGHLIGHT_THRESHOLDS.absoluteLikes) reasons.push('absolute_high_likes')
  if (
    relativeViralIndex !== null &&
    relativeViralIndex >= HIGHLIGHT_THRESHOLDS.relativeViralIndex
  ) {
    reasons.push('relative_viral')
  }
  if (
    referenceValueScore !== null &&
    referenceValueScore >= HIGHLIGHT_THRESHOLDS.referenceValueScore
  ) {
    reasons.push('high_reference_value')
  }

  return { isHighlight: reasons.length > 0, reasons, relativeViralIndex }
}
