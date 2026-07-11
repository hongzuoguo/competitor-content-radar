import { describe, expect, it } from 'vitest'
import { canTransition, nextStage, WORKFLOW_STAGES } from '../../src/core/workflow'

describe('work processing state machine', () => {
  it('defines every confirmed processing stage in order', () => {
    expect(WORKFLOW_STAGES).toEqual([
      'discovered',
      'downloaded',
      'audio_extracted',
      'transcribed',
      'analyzed',
      'synced',
      'completed'
    ])
  })

  it('allows moving to the next stage only', () => {
    expect(canTransition('downloaded', 'audio_extracted')).toBe(true)
    expect(canTransition('downloaded', 'analyzed')).toBe(false)
    expect(canTransition('completed', 'completed')).toBe(false)
  })

  it('returns the next resumable stage', () => {
    expect(nextStage('transcribed')).toBe('analyzed')
    expect(nextStage('completed')).toBeNull()
  })
})
