import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/ipc-contract'

describe('desktop IPC contract', () => {
  it('exposes named operations instead of raw Node access', () => {
    expect(IPC_CHANNELS).toEqual({
      appMetadata: 'app:metadata',
      dashboard: 'dashboard:get',
      runNow: 'runs:start-now',
      openExternal: 'system:open-external',
      creatorList: 'creators:list',
      creatorAdd: 'creators:add',
      creatorDelete: 'creators:delete',
      creatorToggle: 'creators:toggle',
      douyinLogin: 'douyin:login',
      settingsGet: 'settings:get',
      settingsSave: 'settings:save',
      updateGet: 'updates:get',
      updateRetry: 'updates:retry',
      updateStateChanged: 'updates:state-changed',
      importPickLocal: 'imports:pick-local',
      importStart: 'imports:start',
      importRetry: 'imports:retry',
      workList: 'works:list',
      workGet: 'works:get',
      workDeleteFailed: 'works:delete-failed',
      workStateChanged: 'works:state-changed',
      workFocusRequested: 'works:focus-requested'
    })
  })
})
