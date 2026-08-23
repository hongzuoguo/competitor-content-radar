import type { EngagementMetrics } from './domain'
import { evaluateHighlight, type HighlightEvaluation, type HighlightThresholdOverrides } from './highlight-rules'

export type RadarStatus = 'newly_viral' | 'warming' | 'cooling' | 'strong' | 'watching'

export interface RadarSnapshot {
  capturedAt: string
  metrics: EngagementMetrics
}

export interface RadarEvaluation {
  highlight: HighlightEvaluation
  status: RadarStatus | null
  evidence: string[]
  firstBecameViralAt: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

export function evaluateRadarStatus(
  current: EngagementMetrics,
  snapshots: readonly RadarSnapshot[],
  baseline: readonly number[],
  thresholds: HighlightThresholdOverrides = {},
  now = new Date()
): RadarEvaluation {
  const highlight = evaluateHighlight(current, baseline, thresholds)
  if (!highlight.isHighlight) return { highlight, status: null, evidence: [], firstBecameViralAt: null }

  const ordered = [...snapshots]
    .filter((snapshot) => Number.isFinite(Date.parse(snapshot.capturedAt)))
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt))
  const firstBecameViralAt = confirmedFirstViralAt(ordered, baseline, thresholds)
  if (firstBecameViralAt) {
    const age = now.getTime() - Date.parse(firstBecameViralAt)
    if (age >= 0 && age <= DAY_MS) {
      return {
        highlight,
        status: 'newly_viral',
        firstBecameViralAt,
        evidence: [`${formatDateTime(firstBecameViralAt)}首次达到爆款标准`, currentThresholdEvidence(highlight, current)]
      }
    }
  }

  const daily = lastSnapshotPerLocalDay(ordered)
  const recent = daily.slice(-4)
  if (recent.length < 4 || !hasConsecutiveLocalDays(recent)) {
    return {
      highlight,
      status: 'watching',
      firstBecameViralAt,
      evidence: [`当前只有 ${recent.length} 个有效日快照，判断三日趋势至少需要连续 4 个日快照。`, currentThresholdEvidence(highlight, current)]
    }
  }

  const weightedDeltas = consecutiveDeltas(recent, weightedEngagement)
  const likesDeltas = consecutiveDeltas(recent, (metrics) => metrics.likes)
  const totalDelta = weightedDeltas.reduce((total, value) => total + value, 0)
  const first = weightedDeltas[0]
  const last = weightedDeltas[2]
  const increasing = first < weightedDeltas[1] && weightedDeltas[1] < last && changedByAtLeastFivePercent(first, last)
  const decreasing = first > weightedDeltas[1] && weightedDeltas[1] > last && changedByAtLeastFivePercent(last, first)
  const trendEvidence = [
    `近 3 日新增点赞：${likesDeltas.map(formatInteger).join('、')}`,
    `近 3 日综合互动增量：${weightedDeltas.map(formatInteger).join('、')}`
  ]

  if (increasing && totalDelta >= 50) {
    return { highlight, status: 'warming', firstBecameViralAt, evidence: [...trendEvidence, `综合互动日增量首尾提高 ${formatPercent(first, last)}。`] }
  }
  if (decreasing) {
    return { highlight, status: 'cooling', firstBecameViralAt, evidence: [...trendEvidence, `综合互动日增量首尾降低 ${formatPercent(last, first)}。`] }
  }
  return {
    highlight,
    status: totalDelta >= 50 ? 'strong' : 'watching',
    firstBecameViralAt,
    evidence: totalDelta >= 50
      ? [...trendEvidence, '仍达到爆款标准，但近 3 日没有形成连续升温或回落。']
      : [...trendEvidence, '近 3 日有效互动增量不足 50，暂不判断趋势。']
  }
}

function confirmedFirstViralAt(
  snapshots: readonly RadarSnapshot[],
  baseline: readonly number[],
  thresholds: HighlightThresholdOverrides
): string | null {
  let previouslyViral = snapshots.length > 0
    ? evaluateHighlight(snapshots[0].metrics, baseline, thresholds).isHighlight
    : false
  for (let index = 1; index < snapshots.length; index += 1) {
    const viral = evaluateHighlight(snapshots[index].metrics, baseline, thresholds).isHighlight
    if (viral && !previouslyViral) return snapshots[index].capturedAt
    previouslyViral = viral
  }
  return null
}

function lastSnapshotPerLocalDay(snapshots: readonly RadarSnapshot[]): RadarSnapshot[] {
  const byDay = new Map<string, RadarSnapshot>()
  for (const snapshot of snapshots) byDay.set(localDayKey(new Date(snapshot.capturedAt)), snapshot)
  return [...byDay.values()].sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt))
}

function hasConsecutiveLocalDays(snapshots: readonly RadarSnapshot[]): boolean {
  const ordinals = snapshots.map((snapshot) => localDayOrdinal(new Date(snapshot.capturedAt)))
  return ordinals.every((value, index) => index === 0 || value - ordinals[index - 1] === 1)
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function localDayOrdinal(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS
}

function consecutiveDeltas(snapshots: readonly RadarSnapshot[], valueOf: (metrics: EngagementMetrics) => number): number[] {
  return snapshots.slice(1).map((snapshot, index) => Math.max(0, valueOf(snapshot.metrics) - valueOf(snapshots[index].metrics)))
}

function weightedEngagement(metrics: EngagementMetrics): number {
  return metrics.likes + metrics.comments * 3 + metrics.collects * 4 + metrics.shares * 4
}

function changedByAtLeastFivePercent(smaller: number, larger: number): boolean {
  if (larger <= smaller) return false
  if (smaller === 0) return larger > 0
  return (larger - smaller) / smaller >= 0.05
}

function currentThresholdEvidence(highlight: HighlightEvaluation, metrics: EngagementMetrics): string {
  if (highlight.reasons.includes('absolute_high_likes')) return `当前点赞 ${formatInteger(metrics.likes)}，已达到 10,000 点赞标准。`
  return `当前点赞 ${formatInteger(metrics.likes)}，相对表现 ${highlight.relativePerformanceMultiplier ?? '—'}×。`
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString('zh-CN')
}

function formatPercent(smaller: number, larger: number): string {
  if (smaller <= 0) return '超过 100%'
  return `${Math.round(((larger - smaller) / smaller) * 100)}%`
}
