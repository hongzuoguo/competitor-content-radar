import type { Work } from '../../core/domain'
import type { AnalysisRecord, MetricSnapshotRecord } from '../database/repositories'

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item === undefined ? null : item)).join(',')}]`

  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`)
      .join(',')}}`
  }

  return JSON.stringify(value) ?? 'undefined'
}

function workProjection(work: Work) {
  return {
    workId: work.id,
    ownership: work.ownership,
    sourceType: work.sourceType,
    creatorId: work.creatorId,
    title: work.title,
    publishedAt: work.publishedAt,
    originalUrl: work.originalUrl,
    likes: work.metrics.likes,
    comments: work.metrics.comments,
    shares: work.metrics.shares,
    collects: work.metrics.collects
  }
}

function snapshotProjection(snapshot: MetricSnapshotRecord) {
  return {
    workId: snapshot.workId,
    capturedAt: snapshot.capturedAt,
    likes: snapshot.metrics.likes,
    comments: snapshot.metrics.comments,
    shares: snapshot.metrics.shares,
    collects: snapshot.metrics.collects
  }
}

function analysisProjection(analysis: AnalysisRecord) {
  return {
    workId: analysis.workId,
    transcript: analysis.transcript,
    result: analysis.result,
    provider: analysis.provider,
    model: analysis.model,
    promptVersion: analysis.promptVersion
  }
}

export function hasWorkSyncChange(previous: Work | undefined, next: Work): boolean {
  return !previous || stableSerialize(workProjection(previous)) !== stableSerialize(workProjection(next))
}

export function hasSnapshotSyncChange(previous: MetricSnapshotRecord | undefined, next: MetricSnapshotRecord): boolean {
  return !previous || stableSerialize(snapshotProjection(previous)) !== stableSerialize(snapshotProjection(next))
}

export function hasAnalysisSyncChange(previous: AnalysisRecord | undefined, next: AnalysisRecord): boolean {
  return !previous || stableSerialize(analysisProjection(previous)) !== stableSerialize(analysisProjection(next))
}
