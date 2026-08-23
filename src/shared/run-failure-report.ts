import type { RunFailure } from './ipc-contract'
import { safeRunFailure, type SafeRunFailureCode, type SafeRunFailureDisplay } from './run-failure-display'
import { safeWorkFailure, type SafeWorkFailureCode } from './work-failure-display'

export type SafeDiagnostic = Readonly<Record<string, string | number | boolean | null>>
export interface NormalizedRuntimeError {
  readonly run: SafeRunFailureDisplay
  readonly jobCode: SafeWorkFailureCode
  readonly diagnostic?: SafeDiagnostic
}
export type SafeOperationalReportCode = 'WORK_STATE_LISTENER_FAILED' | 'RUN_STATE_PERSISTENCE_FAILED' | 'WEEKLY_TOPIC_CLUSTERING_FAILED'

export function normalizeRuntimeError(error: unknown, stage: RunFailure['stage']): Readonly<NormalizedRuntimeError> {
  const rawCode = safeProperty(error, 'code')
  const safeCode = typeof rawCode === 'string' ? rawCode
    : stage === 'discovery' ? 'DOUYIN_CREATOR_COLLECTION_FAILED'
      : stage === 'feishu' ? 'FEISHU_SYNC_FAILED' : 'WORK_PROCESSING_FAILED'
  const run = safeRunFailure(safeCode, stage)
  const jobCode = safeWorkFailure(rawCode, 'analyzed').code
  const diagnostic = deriveDiagnostic(run.code, safeProperty(error, 'diagnostic'))
  return Object.freeze({ run, jobCode, ...(diagnostic ? { diagnostic } : {}) })
}

export function safeFailureReport(
  normalized: Readonly<NormalizedRuntimeError>,
  identifiers: { stage: RunFailure['stage']; creatorId?: string; workId?: string; runId?: string }
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    code: normalized.run.code,
    stage: identifiers.stage,
    ...safeIdentifiers(identifiers),
    ...(normalized.diagnostic ? { diagnostic: normalized.diagnostic } : {})
  })
}

export function safeOperationalReport(
  code: SafeOperationalReportCode,
  identifiers: { creatorId?: string; workId?: string; runId?: string },
  _ignored?: unknown
): Readonly<Record<string, unknown>> {
  return Object.freeze({ code, ...safeIdentifiers(identifiers) })
}

function safeProperty(value: unknown, key: string): unknown {
  try {
    if (typeof value !== 'object' || value === null || !(key in value)) return undefined
    return (value as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

function deriveDiagnostic(code: SafeRunFailureCode | 'UNKNOWN_FAILURE', input: unknown): SafeDiagnostic | undefined {
  if (code !== 'SCRAPLING_ENGINE_INTERNAL' && code !== 'AI_ANALYSIS_INVALID') return undefined
  const output: Record<string, string | number> = {}
  if (code === 'SCRAPLING_ENGINE_INTERNAL') {
    assignCount(output, 'payloadCount', safeProperty(input, 'payloadCount'))
    assignCount(output, 'responseCount', safeLength(safeProperty(input, 'responses')))
    assignCount(output, 'payloadSummaryCount', safeLength(safeProperty(input, 'payloads')))
    output.exceptionKind = exceptionKind(safeProperty(input, 'exceptionType'))
  } else {
    assignCount(output, 'attemptCount', safeLength(safeProperty(input, 'attempts')))
  }
  return Object.keys(output).length > 0 ? Object.freeze(output) : undefined
}

function assignCount(output: Record<string, string | number>, key: string, value: unknown): void {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000) output[key] = value
}

function safeLength(value: unknown): unknown {
  try {
    return typeof value === 'object' && value !== null ? (value as { length?: unknown }).length : undefined
  } catch {
    return undefined
  }
}

function exceptionKind(value: unknown): string {
  return value === 'TargetClosedError' ? 'TARGET_CLOSED'
    : value === 'TimeoutError' ? 'TIMEOUT'
      : value === 'ProtocolError' ? 'PROTOCOL_ERROR'
        : value === 'BrowserClosedError' ? 'BROWSER_CLOSED'
          : 'UNKNOWN_EXCEPTION'
}

function safeIdentifiers(input: { creatorId?: string; workId?: string; runId?: string }): Record<string, string> {
  const output: Record<string, string> = {}
  if (input.creatorId && /^[A-Za-z0-9_-]{1,200}$/.test(input.creatorId)) output.creatorId = input.creatorId
  if (input.runId && /^[A-Za-z0-9_-]{1,200}$/.test(input.runId)) output.runId = input.runId
  if (input.workId && /^(?:[A-Za-z0-9_-]{1,200}|douyin:[0-9]{1,32})$/.test(input.workId)) output.workId = input.workId
  return output
}
