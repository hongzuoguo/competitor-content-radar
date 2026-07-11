import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/ipc-contract'

describe('desktop IPC contract', () => {
  it('exposes named operations instead of raw Node access', () => {
    expect(IPC_CHANNELS).toEqual({
      appMetadata: 'app:metadata',
      dashboard: 'dashboard:get',
      runNow: 'runs:start-now',
      openExternal: 'system:open-external'
    })
  })
})
