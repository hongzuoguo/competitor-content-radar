import { describe, expect, it } from 'vitest'
import type { RunHistoryItem } from '../../src/shared/ipc-contract'
import {
  formatRunAnalysisSummary,
  formatRunCollectionSummary,
  formatRunSuccessLabel
} from '../../src/renderer/src/features/runs/run-copy'

function run(overrides: Partial<RunHistoryItem> = {}): RunHistoryItem {
  return {
    id: 'run-1', kind: 'manual', status: 'completed',
    startedAt: '2026-07-18T14:25:37.000Z', finishedAt: '2026-07-18T14:27:24.000Z',
    discovered: 36, selectedForAnalysis: 0, analyzed: 0, failures: [],
    ...overrides
  }
}

describe('task run copy', () => {
  it('separates successful collection from an empty analysis queue', () => {
    const item = run()
    expect(formatRunCollectionSummary(item)).toBe('采集/更新 36 条')
    expect(formatRunAnalysisSummary(item)).toBe('本次没有新增爆款需要拆解')
    expect(formatRunSuccessLabel(item)).toBe('采集完成')
  })

  it('does not describe a running task as completed', () => {
    const item = run({ status: 'running', finishedAt: null, discovered: 0 })

    expect(formatRunCollectionSummary(item)).toBe('正在采集，当前已更新 0 条')
    expect(formatRunAnalysisSummary(item)).toBe('采集完成后判断是否需要拆解')
    expect(formatRunSuccessLabel(item)).toBe('采集中')
  })

  it('describes completed viral analysis', () => {
    expect(formatRunAnalysisSummary(run({ selectedForAnalysis: 3, analyzed: 3 })))
      .toBe('发现 3 条爆款，已拆解 3 条')
  })

  it('counts only analysis failures in the analysis result', () => {
    const item = run({
      status: 'partial', selectedForAnalysis: 3, analyzed: 1,
      failures: [
        { creatorId: 'c1', creatorName: '博主', stage: 'analysis', code: 'AI_FAILED', message: '失败', occurredAt: '2026-07-18T14:27:00.000Z' },
        { creatorId: 'c2', creatorName: '博主2', stage: 'discovery', code: 'CAPTURE_FAILED', message: '失败', occurredAt: '2026-07-18T14:27:01.000Z' }
      ]
    })
    expect(formatRunAnalysisSummary(item)).toBe('发现 3 条爆款，成功拆解 1 条，失败 1 条')
    expect(formatRunCollectionSummary(item)).toBe('已采集/更新 36 条，1 个来源采集失败')
  })
})
