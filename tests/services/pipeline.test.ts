import { describe, expect, it, vi } from 'vitest'
import { ProcessingPipeline } from '../../src/services/pipeline/pipeline'
import { PIPELINE_CONCURRENCY } from '../../src/services/pipeline/job-queue'
import type { WorkflowStage } from '../../src/core/workflow'

describe('resumable processing pipeline', () => {
  it('uses the confirmed stage concurrency limits', () => {
    expect(PIPELINE_CONCURRENCY).toEqual({
      discovery: 1,
      download: 2,
      transcription: 1,
      analysis: 2,
      feishu: 1
    })
  })

  it('resumes after the last successful stage', async () => {
    let stage: WorkflowStage = 'transcribed'
    const saveStage = vi.fn(async (_workId: string, next: WorkflowStage) => {
      stage = next
    })
    const handlers = {
      download: vi.fn(),
      extractAudio: vi.fn(),
      transcribe: vi.fn(),
      analyze: vi.fn(),
      sync: vi.fn()
    }
    const pipeline = new ProcessingPipeline(
      { getStage: async () => stage, saveStage, recordFailure: vi.fn() },
      handlers
    )

    await pipeline.process('work-1')

    expect(handlers.download).not.toHaveBeenCalled()
    expect(handlers.transcribe).not.toHaveBeenCalled()
    expect(handlers.analyze).toHaveBeenCalledWith('work-1')
    expect(handlers.sync).toHaveBeenCalledWith('work-1')
    expect(stage).toBe('completed')
  })

  it('records a user-action failure without advancing the stage', async () => {
    const recordFailure = vi.fn()
    const pipeline = new ProcessingPipeline(
      {
        getStage: async () => 'discovered',
        saveStage: vi.fn(),
        recordFailure
      },
      {
        download: vi.fn().mockRejectedValue(
          Object.assign(new Error('登录已过期'), { code: 'DOUYIN_AUTH_EXPIRED', retryable: false })
        ),
        extractAudio: vi.fn(),
        transcribe: vi.fn(),
        analyze: vi.fn(),
        sync: vi.fn()
      }
    )

    await expect(pipeline.process('work-1')).rejects.toThrow('登录已过期')
    expect(recordFailure).toHaveBeenCalledWith(
      'work-1',
      expect.objectContaining({ code: 'DOUYIN_AUTH_EXPIRED', retryAt: null })
    )
  })
})
