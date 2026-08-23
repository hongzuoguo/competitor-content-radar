import { describe, expect, it, vi } from 'vitest'
import { normalizeRuntimeError, safeFailureReport, safeOperationalReport } from '../../src/shared/run-failure-report'

describe('safe runtime failure reports', () => {
  it('normalizes a hostile Proxy without throwing or retaining raw content', () => {
    const hostile = new Proxy({}, {
      has: () => { throw new Error('Bearer secret-token') },
      get: () => { throw new Error('C:\\private\\stack stderr') },
      getPrototypeOf: () => { throw new Error('prototype secret') }
    })

    expect(() => normalizeRuntimeError(hostile, 'discovery')).not.toThrow()
    const normalized = normalizeRuntimeError(hostile, 'discovery')
    expect(normalized.run.code).toBe('DOUYIN_CREATOR_COLLECTION_FAILED')
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(JSON.stringify(normalized)).not.toMatch(/Bearer|private|stack|stderr|prototype/)
  })

  it('maps only exact safe exception kinds and bounded integer diagnostics', () => {
    const normalized = normalizeRuntimeError({
      code: 'SCRAPLING_ENGINE_INTERNAL',
      diagnostic: {
        payloadCount: 3,
        responses: [1, 2],
        payloads: [1],
        exceptionType: 'Bearer:secret-token',
        issueCount: Infinity,
        errorMessage: 'C:\\private'
      }
    }, 'discovery')

    expect(normalized.diagnostic).toEqual({
      payloadCount: 3, responseCount: 2, payloadSummaryCount: 1, exceptionKind: 'UNKNOWN_EXCEPTION'
    })
    expect(Object.isFrozen(normalized.diagnostic)).toBe(true)
    expect(JSON.stringify(normalized)).not.toMatch(/secret-token|private/)
  })

  it('counts the real AI attempt diagnostic shape without retaining issue content', () => {
    const normalized = normalizeRuntimeError({
      code: 'AI_ANALYSIS_INVALID',
      diagnostic: { attempts: [{ issues: [{ path: 'private', message: 'Bearer secret' }] }, { issues: [] }] }
    }, 'analysis')

    expect(normalized.diagnostic).toEqual({ attemptCount: 2 })
    expect(JSON.stringify(normalized)).not.toMatch(/private|Bearer|secret/)
  })

  it('keeps valid field-specific IDs and drops hostile ones', () => {
    const normalized = normalizeRuntimeError({ code: 'WORK_PROCESSING_FAILED' }, 'analysis')
    expect(safeFailureReport(normalized, { stage: 'analysis', creatorId: 'creator-1', runId: 'run_1', workId: 'douyin:123' }))
      .toMatchObject({ creatorId: 'creator-1', runId: 'run_1', workId: 'douyin:123' })
    expect(safeFailureReport(normalized, { stage: 'analysis', creatorId: 'C:\\secret', runId: 'Bearer:token', workId: 'douyin:https://secret' }))
      .toEqual({ code: 'WORK_PROCESSING_FAILED', stage: 'analysis' })
  })

  it('does not inspect operational exceptions', () => {
    const trap = vi.fn(() => { throw new Error('must not read') })
    const hostile = new Proxy({}, { get: trap, has: trap, getPrototypeOf: trap })
    expect(safeOperationalReport('RUN_STATE_PERSISTENCE_FAILED', { runId: 'run-1' }, hostile)).toEqual({
      code: 'RUN_STATE_PERSISTENCE_FAILED', runId: 'run-1'
    })
    expect(trap).not.toHaveBeenCalled()
  })
})
