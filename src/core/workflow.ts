export const WORKFLOW_STAGES = [
  'discovered',
  'downloaded',
  'audio_extracted',
  'transcribed',
  'analyzed',
  'synced',
  'completed'
] as const

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number]

export function nextStage(stage: WorkflowStage): WorkflowStage | null {
  const index = WORKFLOW_STAGES.indexOf(stage)
  return WORKFLOW_STAGES[index + 1] ?? null
}

export function canTransition(from: WorkflowStage, to: WorkflowStage): boolean {
  return nextStage(from) === to
}
