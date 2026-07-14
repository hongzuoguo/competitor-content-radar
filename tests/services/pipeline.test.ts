import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelManager } from '../../src/services/asr/model-manager'
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

  it('records the stable model preparation code from transcription', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-pipeline-model-'))
    const recordFailure = vi.fn()
    const manager = new ModelManager(vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')))
    const pipeline = new ProcessingPipeline(
      { getStage: async () => 'audio_extracted', saveStage: vi.fn(), recordFailure },
      {
        download: vi.fn(),
        extractAudio: vi.fn(),
        transcribe: vi.fn(() => manager.ensureFile(
          { url: 'https://example.test/tokens.txt', size: 4, sha256: '0'.repeat(64) },
          join(directory, 'tokens.txt')
        )),
        analyze: vi.fn(),
        sync: vi.fn()
      }
    )

    try {
      await expect(pipeline.process('work-1')).rejects.toMatchObject({ code: 'MODEL_PREPARATION_FAILED' })
      expect(recordFailure).toHaveBeenCalledWith(
        'work-1',
        expect.objectContaining({ code: 'MODEL_PREPARATION_FAILED' })
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
