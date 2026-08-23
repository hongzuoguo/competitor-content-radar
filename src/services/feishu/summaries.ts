import type { Work } from '../../core/domain'
import { calculateEngagement } from '../../core/highlight-rules'
import type { MetricSnapshotRecord } from '../database/repositories'
import type { ContentTermClusterResult } from '../ai/content-term-clustering'
import {
  isContainedByMoreSpecificKeyword,
  isWeakKeyword,
  normalizeKeyword
} from './keyword-quality'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export interface FeishuSummaryWork {
  work: Work
  creatorName: string
  category: string
  keywords: string
}

export interface GrowthTop10Row {
  id: string
  rank: number
  workId: string
  title: string
  creatorName: string
  growthRate: number
  engagementGrowth: number
  latestEngagement: number
  shortTitle: string
  originalUrl: string | null
}

export interface CreativeDirectionRow {
  id: string
  direction: string
  workCount: number
  averageEngagement: number
  sevenDayGrowth: number
  keywords: string
  representativeWork: string
  recommendation: '优先跟进' | '持续观察' | '值得测试'
}

export interface HotContentTermRow {
  id: string
  term: string
  workCount: number
  totalEngagement: number
  averageEngagement: number
  representativeWork: string
}

export function buildGrowthTop10(
  works: readonly FeishuSummaryWork[],
  snapshots: readonly MetricSnapshotRecord[],
  now: Date
): GrowthTop10Row[] {
  const histories = groupSnapshotsInWindow(snapshots, now)
  const ranked = works.flatMap((item) => {
    const growth = growthFromHistory(histories.get(item.work.id) ?? [])
    if (!growth || growth.amount <= 0) return []
    return [{
      workId: item.work.id,
      title: item.work.title,
      creatorName: item.creatorName,
      growthRate: roundOneDecimal(growth.rate),
      engagementGrowth: growth.amount,
      latestEngagement: growth.latest,
      shortTitle: shortTitle(item.work.title),
      originalUrl: item.work.originalUrl
    }]
  }).sort((left, right) => (
    right.growthRate - left.growthRate
    || right.engagementGrowth - left.engagementGrowth
    || left.workId.localeCompare(right.workId)
  )).slice(0, 10)

  return ranked.map((row, index) => ({
    id: `growth-top-${index + 1}`,
    rank: index + 1,
    ...row
  }))
}

export function buildCreativeDirections(
  works: readonly FeishuSummaryWork[],
  snapshots: readonly MetricSnapshotRecord[],
  now: Date
): CreativeDirectionRow[] {
  const histories = groupSnapshotsInWindow(snapshots, now)
  const groups = new Map<string, FeishuSummaryWork[]>()
  for (const item of works) {
    const direction = item.category.trim() || '未分类'
    const group = groups.get(direction) ?? []
    group.push(item)
    groups.set(direction, group)
  }

  const rows = Array.from(groups, ([direction, items]) => {
    const engagementTotal = items.reduce(
      (total, item) => total + calculateEngagement(item.work.metrics),
      0
    )
    const representative = [...items].sort((left, right) => (
      calculateEngagement(right.work.metrics) - calculateEngagement(left.work.metrics)
      || left.work.id.localeCompare(right.work.id)
    ))[0]
    const sevenDayGrowth = items.reduce((total, item) => {
      const growth = growthFromHistory(histories.get(item.work.id) ?? [])
      return total + Math.max(0, growth?.amount ?? 0)
    }, 0)
    return {
      id: `direction:${direction}`,
      direction,
      workCount: items.length,
      averageEngagement: Math.round(engagementTotal / items.length),
      sevenDayGrowth,
      keywords: representativeKeywords(items, direction),
      representativeWork: representative?.work.title ?? '',
      recommendation: '值得测试' as CreativeDirectionRow['recommendation']
    }
  }).sort((left, right) => (
    right.averageEngagement - left.averageEngagement
    || left.direction.localeCompare(right.direction)
  ))

  const priorityCount = Math.max(1, Math.ceil(rows.length / 3))
  return rows.map((row, index) => ({
    ...row,
    recommendation: row.workCount === 1
      ? '持续观察'
      : index < priorityCount ? '优先跟进' : '值得测试'
  }))
}

export function buildHotContentTerms(
  works: readonly FeishuSummaryWork[],
  clusters: ContentTermClusterResult
): HotContentTermRow[] {
  const byId = new Map(works.map((item) => [item.work.id, item]))
  return clusters.terms.flatMap((term) => {
    const items = term.workIds.flatMap((id) => {
      const item = byId.get(id)
      return item ? [item] : []
    })
    if (items.length === 0) return []
    const ranked = [...items].sort((left, right) => (
      calculateEngagement(right.work.metrics) - calculateEngagement(left.work.metrics)
      || left.work.id.localeCompare(right.work.id)
    ))
    const totalEngagement = items.reduce(
      (total, item) => total + calculateEngagement(item.work.metrics),
      0
    )
    return [{
      id: `term:${term.name}`,
      term: term.name,
      workCount: items.length,
      totalEngagement,
      averageEngagement: Math.round(totalEngagement / items.length),
      representativeWork: ranked[0]?.work.title ?? ''
    }]
  }).sort((left, right) => (
    right.totalEngagement - left.totalEngagement
    || right.workCount - left.workCount
    || left.term.localeCompare(right.term)
  ))
}

function groupSnapshotsInWindow(
  snapshots: readonly MetricSnapshotRecord[],
  now: Date
): Map<string, MetricSnapshotRecord[]> {
  const start = now.getTime() - SEVEN_DAYS_MS
  const grouped = new Map<string, MetricSnapshotRecord[]>()
  for (const snapshot of snapshots) {
    const capturedAt = Date.parse(snapshot.capturedAt)
    if (!Number.isFinite(capturedAt) || capturedAt < start || capturedAt > now.getTime()) continue
    const history = grouped.get(snapshot.workId) ?? []
    history.push(snapshot)
    grouped.set(snapshot.workId, history)
  }
  for (const history of grouped.values()) {
    history.sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt))
  }
  return grouped
}

function growthFromHistory(history: readonly MetricSnapshotRecord[]): {
  amount: number
  rate: number
  latest: number
} | null {
  const valid = history.filter((snapshot) => calculateEngagement(snapshot.metrics) > 0)
  if (valid.length < 2) return null
  const earliest = calculateEngagement(valid[0].metrics)
  const latest = calculateEngagement(valid.at(-1)!.metrics)
  const amount = latest - earliest
  return { amount, rate: amount / earliest * 100, latest }
}

function representativeKeywords(items: readonly FeishuSummaryWork[], direction: string): string {
  const counts = new Map<string, { value: string; count: number; order: number }>()
  const normalizedDirection = normalizeKeyword(direction)
  let order = 0
  for (const item of items) {
    for (const value of item.keywords.split(/[、,，]/u).map((part) => part.trim()).filter(Boolean)) {
      const key = normalizeKeyword(value)
      if (
        isWeakKeyword(key)
        || key === normalizedDirection
        || normalizedDirection.includes(key)
      ) continue
      const existing = counts.get(key)
      if (existing) existing.count += 1
      else counts.set(key, { value, count: 1, order: order++ })
    }
  }
  const ranked = Array.from(counts.values())
    .sort((left, right) => right.count - left.count || left.order - right.order)
  const values = ranked.map((item) => item.value)
  return ranked
    .filter((item) => !isContainedByMoreSpecificKeyword(item.value, values))
    .slice(0, 3)
    .map((item) => item.value)
    .join('、')
}

function shortTitle(value: string): string {
  const characters = Array.from(value.trim())
  return characters.length <= 18 ? characters.join('') : `${characters.slice(0, 18).join('')}…`
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}
