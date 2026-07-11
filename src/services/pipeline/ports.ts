import type { WorkflowStage } from '../../core/workflow'

export interface PipelineFailure {
  code: string
  message: string
  retryAt: string | null
  attempt: number
}

export interface PipelineJobStore {
  getStage(workId: string): Promise<WorkflowStage>
  saveStage(workId: string, stage: WorkflowStage): Promise<void>
  recordFailure(workId: string, failure: PipelineFailure): Promise<void> | void
}

export interface PipelineHandlers {
  download(workId: string): Promise<void>
  extractAudio(workId: string): Promise<void>
  transcribe(workId: string): Promise<void>
  analyze(workId: string): Promise<void>
  sync(workId: string): Promise<void>
}

export interface PipelineTaskError extends Error {
  code?: string
  retryable?: boolean
  retryAfterSeconds?: number
  attempt?: number
}
