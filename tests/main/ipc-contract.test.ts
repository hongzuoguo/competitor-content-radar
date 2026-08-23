import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS, isFeishuSyncMode, type EngineHealthView, type IpcResult } from '../../src/shared/ipc-contract'

describe('desktop IPC contract', () => {
  it('exposes named operations instead of raw Node access', () => {
    expect(IPC_CHANNELS).toEqual({
      dashboard: 'dashboard:get',
      runNow: 'runs:start-now',
      runList: 'runs:list',
      runRetry: 'runs:retry',
      runRetryCreators: 'runs:retry-creators',
      runDelete: 'runs:delete',
      openExternal: 'system:open-external',
      creatorList: 'creators:list',
      creatorAdd: 'creators:add',
      creatorAddMine: 'creators:add-mine',
      creatorDelete: 'creators:delete',
      creatorToggle: 'creators:toggle',
      sourceClearUnclassified: 'sources:clear-unclassified',
      douyinLogin: 'douyin:login',
      douyinLogout: 'douyin:logout',
      douyinCheckLogin: 'douyin:check-login',
      settingsGet: 'settings:get',
      settingsSave: 'settings:save',
      settingsRestoreRecommended: 'settings:restore-recommended',
      updateGet: 'updates:get',
      updateRetry: 'updates:retry',
      updateStateChanged: 'updates:state-changed',
      importPickLocal: 'imports:pick-local',
      importStart: 'imports:start',
      importRetry: 'imports:retry',
      workList: 'works:list',
      workGet: 'works:get',
      workAnalyze: 'works:analyze',
      workDeleteFailed: 'works:delete-failed',
      workStateChanged: 'works:state-changed',
      workFocusRequested: 'works:focus-requested',
      feishuGet: 'feishu:get',
      feishuConnectCustomApp: 'feishu:connect-custom-app',
      feishuDisconnect: 'feishu:disconnect',
      feishuSync: 'feishu:sync',
      feishuRepair: 'feishu:repair',
      feishuRecreate: 'feishu:recreate',
      feishuOpenBase: 'feishu:open-base',
      feishuOpenDeveloperConsole: 'feishu:open-developer-console',
      modelProfileList: 'modelProfiles:list',
      modelProfileCreate: 'modelProfiles:create',
      modelProfileUpdate: 'modelProfiles:update',
      modelProfileTest: 'modelProfiles:test',
      modelProfileActivate: 'modelProfiles:activate',
      modelProfileDelete: 'modelProfiles:delete',
      modelProfileDeleteKey: 'modelProfiles:deleteKey',
      engineHealthPeek: 'engine-health:peek',
      engineHealthGet: 'engine-health:get',
      engineHealthRefresh: 'engine-health:refresh',
      agentStatus: 'agent:status',
      agentDetectCli: 'agent:detect-cli',
      workRewrite: 'works:rewrite'
    })
    expect(Object.values(IPC_CHANNELS)).not.toContain('agent:mcp-config')
  })

  it('defines a serializable, secret-free engine-health view', () => {
    const health: EngineHealthView = {
      cloud: { status: 'healthy', checkedAt: '2026-08-09T12:00:00.000Z', fingerprint: 'profile-1', code: null, message: null },
      codex: { status: 'unhealthy', checkedAt: '2026-08-09T12:00:00.000Z', fingerprint: 'codex-v1', code: 'CODEX_LOGIN_REQUIRED', message: '请先登录 Codex。' },
      checking: false
    }

    const serialized = JSON.parse(JSON.stringify(health)) as Record<string, unknown>
    expect(serialized).toEqual(health)
    expect(JSON.stringify(serialized)).not.toMatch(/api.?key|bearer|prompt|stdout|stderr/i)
  })

  it('defines automatic and manual Feishu sync modes for settings validation', () => {
    expect(isFeishuSyncMode('auto')).toBe(true)
    expect(isFeishuSyncMode('manual')).toBe(true)
    expect(isFeishuSyncMode('on-change')).toBe(false)
  })

  it('defines serializable Feishu result envelopes for IPC boundaries', () => {
    const success: IpcResult<{ connected: boolean }> = { ok: true, value: { connected: true } }
    const failure: IpcResult<{ connected: boolean }> = {
      ok: false,
      error: {
        code: 'FEISHU_NETWORK_ERROR', title: '暂时无法连接飞书', reason: '网络、代理或飞书服务异常',
        action: '请检查网络后重试', retryable: true
      }
    }

    expect(JSON.parse(JSON.stringify(success))).toEqual(success)
    expect(JSON.parse(JSON.stringify(failure))).toEqual(failure)
  })
})
