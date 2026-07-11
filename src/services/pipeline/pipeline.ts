import { nextStage, type WorkflowStage } from '../../core/workflow'
import type {
  PipelineHandlers,
  PipelineJobStore,
  PipelineTaskError
} from './ports'
import { retryDelayMs } from './retry-policy'

const HANDLER_BY_STAGE: Partial<Record<WorkflowStage, keyof PipelineHandlers>> = {
  downloaded: 'download',
  audio_extracted: 'extractAudio',
  transcribed: 'transcribe',
  analyzed: 'analyze',
  synced: 'sync'
}

export class ProcessingPipeline {
  constructor(
    private readonly store: PipelineJobStore,
    private readonly handlers: PipelineHandlers,
    private readonly now: () => Date = () => new Date()
  ) {}

  async process(workId: string): Promise<void> {
    let current = await this.store.getStage(workId)

    while (current !== 'completed') {
      const target = nextStage(current)
      if (!target) return

      try {
        const handler = HANDLER_BY_STAGE[target]
        if (handler) await this.handlers[handler](workId)
        await this.store.saveStage(workId, target)
        current = target
      } catch (unknownError) {
        const error = unknownError as PipelineTaskError
        const attempt = error.attempt ?? 1
        const delay = error.retryable === false
          ? null
          : retryDelayMs(attempt, error.retryAfterSeconds)
        const retryAt = delay === null
          ? null
          : new Date(this.now().getTime() + delay).toISOString()

        await this.store.recordFailure(workId, {
          code: error.code ?? 'PIPELINE_STAGE_FAILED',
          message: error.message,
          retryAt,
          attempt
        })
        throw error
      }
    }
  }
}
