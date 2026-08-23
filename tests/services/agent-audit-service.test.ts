import { describe, expect, it } from 'vitest'
import { AgentAuditService } from '../../src/services/agent/agent-audit-service'

describe('AgentAuditService', () => {
  it('stores only bounded metadata and a sanitized error code', () => {
    const records: unknown[] = []
    const service = new AgentAuditService({ create: (record) => { records.push(record) } }, {
      createId: () => 'audit-1',
      now: () => '2026-08-02T10:00:00.000Z'
    })
    service.record({
      capability: 'works.get',
      source: 'local-api',
      success: false,
      errorCode: 'Bearer secret transcript body',
      durationMs: 12
    })
    expect(records).toEqual([{
      id: 'audit-1',
      capability: 'works.get',
      source: 'local-api',
      success: false,
      errorCode: 'AGENT_REQUEST_FAILED',
      durationMs: 12,
      createdAt: '2026-08-02T10:00:00.000Z'
    }])
  })
})
