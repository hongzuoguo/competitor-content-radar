import type { WorkListItem } from '../../../../shared/ipc-contract'
import { safeWorkFailure } from '../../../../shared/work-failure-display'

/** Stable human-readable message for a failed work item. */
export function stableWorkErrorMessage(work: Pick<WorkListItem, 'errorCode' | 'stage'>): string {
  return safeWorkFailure(work.errorCode, work.stage).message
}
