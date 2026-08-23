import type { RunFailure } from '../../../../shared/ipc-contract'
import { safeRunFailure } from '../../../../shared/run-failure-display'

export function runFailureDisplayMessage(failure: Pick<RunFailure, 'code' | 'message' | 'stage'>): string {
  return safeRunFailure(failure.code, failure.stage).message
}

export function runFailureDisplayCode(failure: Pick<RunFailure, 'code' | 'stage'>): string {
  return safeRunFailure(failure.code, failure.stage).code
}
