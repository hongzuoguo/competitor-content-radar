import { describe, expect, it } from 'vitest'
import type { Work } from '../../src/core/domain'
import type {
  AnalysisRecord,
  MetricSnapshotRecord
} from '../../src/services/database/repositories'
import {
  hasAnalysisSyncChange,
  hasSnapshotSyncChange,
  hasWorkSyncChange
} from '../../src/services/feishu/local-change'

const work: Work = {
  id: 'work-1',
  creatorId: 'creator-1',
  platformWorkId: 'douyin-1',
  sourceType: 'douyin_monitor',
  ownership: 'competitor',
  sourceKey: 'source-1',
  mediaPath: 'E:\\temporary\\old.mp4',
  title: '原标题',
  publishedAt: '2026-08-01T00:00:00.000Z',
  originalUrl: 'https://www.douyin.com/video/1',
  downloadUrl: 'https://example.com/video.mp4',
  metrics: {
    likes: 100,
    comments: 20,
    shares: 10,
    collects: 30
  }
}

const snapshot: MetricSnapshotRecord = {
  id: 'snapshot-1',
  workId: work.id,
  capturedAt: '2026-08-09T00:00:00.000Z',
  metrics: { ...work.metrics }
}

const analysis: AnalysisRecord = {
  workId: work.id,
  transcript: '转写文本',
  result: {
    summary: '原摘要',
    topicAngle: '原选题角度'
  },
  provider: 'deepseek',
  model: 'deepseek-chat',
  promptVersion: 'v1',
  tokenUsage: { input: 100, output: 20 },
  createdAt: '2026-08-09T00:00:00.000Z'
}

describe('Feishu local change projections', () => {
  it('treats a new work as changed', () => {
    expect(hasWorkSyncChange(undefined, work)).toBe(true)
  })

  it('treats an identical work as unchanged', () => {
    expect(hasWorkSyncChange(work, { ...work })).toBe(false)
  })

  it('detects a Feishu-visible work title change', () => {
    expect(hasWorkSyncChange(work, { ...work, title: '新标题' })).toBe(true)
  })

  it('ignores a local media path change', () => {
    expect(hasWorkSyncChange(work, { ...work, mediaPath: 'E:\\temporary\\new.mp4' })).toBe(false)
  })

  it('detects a snapshot metric change', () => {
    expect(hasSnapshotSyncChange(snapshot, {
      ...snapshot,
      metrics: { ...snapshot.metrics, likes: snapshot.metrics.likes + 1 }
    })).toBe(true)
  })

  it('detects an analysis result change', () => {
    expect(hasAnalysisSyncChange(analysis, {
      ...analysis,
      result: { ...analysis.result, summary: '新摘要' }
    })).toBe(true)
  })

  it('ignores analysis result object key order', () => {
    expect(hasAnalysisSyncChange(analysis, {
      ...analysis,
      result: {
        topicAngle: analysis.result.topicAngle,
        summary: analysis.result.summary
      }
    })).toBe(false)
  })

  it('ignores deep analysis result object key order', () => {
    const previous: AnalysisRecord = {
      ...analysis,
      result: {
        outline: {
          hook: '问题开场',
          examples: [
            { title: '案例一', details: { angle: '演示', tone: '直接' } },
            { title: '案例二', details: { angle: '对比', tone: '克制' } }
          ]
        }
      }
    }
    const next: AnalysisRecord = {
      ...analysis,
      result: {
        outline: {
          examples: [
            { details: { tone: '直接', angle: '演示' }, title: '案例一' },
            { details: { tone: '克制', angle: '对比' }, title: '案例二' }
          ],
          hook: '问题开场'
        }
      }
    }

    expect(hasAnalysisSyncChange(previous, next)).toBe(false)
  })

  it('detects analysis result array order changes', () => {
    const previous: AnalysisRecord = { ...analysis, result: { items: ['第一项', '第二项'] } }
    const next: AnalysisRecord = { ...analysis, result: { items: ['第二项', '第一项'] } }

    expect(hasAnalysisSyncChange(previous, next)).toBe(true)
  })

  it('ignores undefined analysis result properties', () => {
    expect(hasAnalysisSyncChange(
      { ...analysis, result: {} },
      { ...analysis, result: { optional: undefined } }
    )).toBe(false)
  })

  it('treats undefined and null analysis result array values as equal', () => {
    expect(hasAnalysisSyncChange(
      { ...analysis, result: { values: [undefined] } },
      { ...analysis, result: { values: [null] } }
    )).toBe(false)
  })
})
