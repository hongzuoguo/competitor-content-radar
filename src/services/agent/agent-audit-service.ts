import { randomUUID } from 'node:crypto'
import type { AgentAuditRecord, AgentAuditRepository } from '../database/repositories'
import type { AgentInvocationSource } from './agent-contract'

export class AgentAuditService {
  private readonly createId: () => string
  private readonly now: () => string

  constructor(
    private readonly repository: Pick<AgentAuditRepository, 'create'>,
    options: { createId?: () => string, now?: () => string } = {}
  ) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date().toISOString())
  }

  record(entry: {
    capability: string
    source: AgentInvocationSource
    success: boolean
    errorCode?: string | null
    durationMs: number
  }): void {
    const record: AgentAuditRecord = {
      id: this.createId(),
      capability: entry.capability.slice(0, 100),
      source: entry.source,
      success: entry.success,
      errorCode: sanitizeErrorCode(entry.errorCode),
      durationMs: Math.max(0, Math.round(entry.durationMs)),
      createdAt: this.now()
    }
    this.repository.create(record)
  }

  listRecent(limit = 20): AgentAuditRecord[] {
    const repository = this.repository as unknown as {
      listRecent?: (limit: number) => AgentAuditRecord[]
    }
    return repository.listRecent?.(limit) ?? []
  }
}

function sanitizeErrorCode(value: string | null | undefined): string | null {
  if (!value) return null
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(value) ? value : 'AGENT_REQUEST_FAILED'
}
