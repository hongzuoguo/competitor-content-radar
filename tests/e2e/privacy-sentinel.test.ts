import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanForbiddenMedia, requireAbsent } from '../helpers/privacy-sentinel'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const secure = vi.hoisted(() => {
  const ciphertexts: string[] = []
  return {
    ciphertexts,
    state: { available: true },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => secure.state.available),
      encryptString: vi.fn((value: string) => {
        const cipher = `cipher:v1:${[...value].reverse().join('')}`
        secure.ciphertexts.push(cipher)
        return Buffer.from(cipher, 'utf8')
      }),
      decryptString: vi.fn((cipher: Buffer) => [...cipher.toString('utf8').replace('cipher:v1:', '')].reverse().join(''))
    }
  }
})

vi.mock('electron', () => ({
  safeStorage: secure.safeStorage,
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)) },
  shell: { openExternal: vi.fn() }
}))

import { AgentAccessService } from '../../src/services/agent/agent-access-service'
import { AgentCliRunner } from '../../src/services/agent/agent-cli-runner'
import { ModelProfileService } from '../../src/services/ai/model-profile-service'
import { AppDatabase } from '../../src/services/database/database'
import { AppRepositories } from '../../src/services/database/repositories'
import { FeishuIntegration } from '../../src/services/feishu/integration'
import { registerIpcHandlers, type IpcDependencies } from '../../src/main/ipc'
import { SecretStore } from '../../src/services/secrets/secret-store'
import { IPC_CHANNELS } from '../../src/shared/ipc-contract'

const profileInput = {
  name: 'Sentinel model',
  providerTemplate: 'deepseek' as const,
  baseUrl: 'https://api.deepseek.com/v1',
  modelId: 'deepseek-chat',
  requiresApiKey: true,
  enabled: true
}

describe('runtime privacy sentinels', () => {
  const tempRoots: string[] = []
  const databases: AppDatabase[] = []

  beforeEach(() => {
    handlers.clear()
    secure.ciphertexts.splice(0)
    secure.state.available = true
    vi.clearAllMocks()
  })

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('keeps dynamically generated credentials and browser markers out of forbidden runtime media', async () => {
    const root = mkdtempSync(join(tmpdir(), 'privacy-sentinel-'))
    tempRoots.push(root)
    const userData = join(root, 'userData')
    const databasePath = join(userData, 'content-radar.db')
    const browserProfile = join(userData, 'scrapling-browser-profile')
    mkdirSync(browserProfile, { recursive: true })

    const agentBytes = Buffer.from(`agent-${randomUUID()}`, 'utf8')
    const sentinels = {
      ai: `ai-${randomUUID()}`,
      feishu: `feishu-${randomUUID()}`,
      agent: agentBytes.toString('base64url'),
      douyin: `douyin-${randomUUID()}`
    }
    const database = new AppDatabase(databasePath)
    databases.push(database)
    const repositories = new AppRepositories(database.connection)
    const secrets = new SecretStore(repositories.settings)
    const modelProfiles = new ModelProfileService({
      profiles: repositories.modelProfiles,
      settings: repositories.settings,
      secrets
    })
    const profile = modelProfiles.create(profileInput, sentinels.ai)
    const agentAccess = new AgentAccessService({ settings: repositories.settings, secrets }, {
      randomBytes: () => agentBytes
    })
    const agentToken = agentAccess.resetToken()
    expect(agentToken === sentinels.agent).toBe(true)
    expect(agentAccess.ensureToken() === agentToken).toBe(true)
    repositories.agentAudits.create({
      id: randomUUID(), capability: 'works.get', source: 'mcp', success: true,
      errorCode: null, durationMs: 1, createdAt: new Date().toISOString()
    })

    secrets.set('feishu.customApp', JSON.stringify({ appId: 'cli_privacy', appSecret: sentinels.feishu }))
    const feishu = new FeishuIntegration({
      repositories,
      credentials: secrets,
      tokenProviderFactory: () => ({ getAccessToken: async () => { throw new Error('UNUSED') } }),
      clientFactory: () => { throw new Error('UNUSED') },
      openExternal: async () => undefined
    })
    writeFileSync(join(browserProfile, 'marker'), sentinels.douyin, 'utf8')

    expect(modelProfiles.getActiveRuntimeProfile()?.apiKey === sentinels.ai).toBe(true)
    const publicValues = [modelProfiles.get(profile.id), feishu.getConnection(), agentAccess.getState(), repositories.agentAudits.listRecent()]
    const connectFeishuCustomApp = vi.fn(async () => { throw new Error(`Bearer ${sentinels.feishu}`) })
    const dependencies = ipcDependencies({
      modelProfiles,
      getFeishuConnection: async () => feishu.getConnection(),
      agentStatus: () => agentAccess.getState(),
      connectFeishuCustomApp
    })
    registerIpcHandlers(dependencies)
    const connectRequest = {
      appId: 'cli_privacy', appSecret: sentinels.feishu, baseUrl: 'https://example.feishu.cn/base/base-privacy'
    }
    const ipcValues = await Promise.all([
      handlers.get(IPC_CHANNELS.modelProfileList)?.({}),
      handlers.get(IPC_CHANNELS.feishuGet)?.({}),
      handlers.get(IPC_CHANNELS.agentStatus)?.({}),
      handlers.get(IPC_CHANNELS.feishuSync)?.({}),
      handlers.get(IPC_CHANNELS.feishuConnectCustomApp)?.({}, connectRequest)
    ])

    const captured = [publicValues, ipcValues]
    const rendererState = join(userData, 'renderer-state')
    const ipcCapture = join(userData, 'ipc-captured-values')
    mkdirSync(rendererState, { recursive: true })
    mkdirSync(ipcCapture, { recursive: true })
    writeFileSync(join(rendererState, 'state.json'), JSON.stringify(captured), 'utf8')
    writeFileSync(join(ipcCapture, 'envelopes.json'), JSON.stringify(captured), 'utf8')

    const fakeCli = join(root, 'fake-cli.cjs')
    writeFileSync(fakeCli, [
      '#!/usr/bin/env node',
      "process.stdout.write(JSON.stringify({ parent: Object.hasOwn(process.env, 'HITMUSE_PRIVACY_PARENT_ONLY'), mcp: process.env.HITMUSE_MCP_TOKEN ?? '' }));",
      "process.stderr.write(process.env.HITMUSE_MCP_TOKEN ?? '');"
    ].join('\n'), 'utf8')
    chmodSync(fakeCli, 0o755)
    const parentOnly = `parent-${randomUUID()}`
    const runner = new AgentCliRunner({
      resolveCommand: async () => process.execPath,
      getEndpoint: () => ({ port: 43100, token: agentToken }),
      environment: { PATH: process.env.PATH, HITMUSE_PRIVACY_PARENT_ONLY: parentOnly },
      timeoutMs: 10_000
    })
    const child = await runner.run({ id: 'codex', command: 'codex', displayName: 'Codex', execArgs: () => [fakeCli, '-'] }, {
      workId: 'privacy-work', transcript: 'privacy probe'
    })
    const childOutput = JSON.parse(child.stdout) as { parent: boolean, mcp: string }

    const logFile = join(userData, 'logs', 'electron-log.log')
    const crashpad = join(userData, 'Crashpad')
    const exportsDirectory = join(userData, 'exports')
    const updaterCache = join(userData, 'updater-cache')
    const releaseFixture = join(root, 'release-fixture')
    mkdirSync(join(userData, 'logs'), { recursive: true })
    mkdirSync(crashpad, { recursive: true })
    mkdirSync(exportsDirectory, { recursive: true })
    mkdirSync(updaterCache, { recursive: true })
    mkdirSync(releaseFixture, { recursive: true })
    writeFileSync(logFile, 'safe-log', 'utf8')
    writeFileSync(join(crashpad, 'report.txt'), 'safe-crash-report', 'utf8')
    writeFileSync(join(exportsDirectory, 'export.json'), '{"status":"safe"}', 'utf8')
    writeFileSync(join(updaterCache, 'cache.json'), '{"status":"safe"}', 'utf8')
    writeFileSync(join(releaseFixture, 'fixture.json'), '{"status":"safe"}', 'utf8')
    const sqliteMedia = [
      { path: databasePath, ruleId: 'SQLITE_MAIN' },
      { path: `${databasePath}-wal`, ruleId: 'SQLITE_WAL' },
      { path: `${databasePath}-shm`, ruleId: 'SQLITE_SHM' }
    ]
    const requiredMediaFiles = [
      databasePath, logFile, join(crashpad, 'report.txt'), join(exportsDirectory, 'export.json'),
      join(updaterCache, 'cache.json'), join(releaseFixture, 'fixture.json'),
      join(rendererState, 'state.json'), join(ipcCapture, 'envelopes.json')
    ]
    const forbidden = [
      ...sqliteMedia,
      { path: logFile, ruleId: 'ELECTRON_LOG' },
      { path: crashpad, ruleId: 'CRASHPAD' },
      { path: exportsDirectory, ruleId: 'EXPORTS' },
      { path: updaterCache, ruleId: 'UPDATER_CACHE' },
      { path: releaseFixture, ruleId: 'RELEASE_FIXTURE' },
      { path: rendererState, ruleId: 'RENDERER_STATE' },
      { path: ipcCapture, ruleId: 'IPC_CAPTURE' }
    ]
    const scan = scanForbiddenMedia(forbidden, Object.values(sentinels))
    const auditResults = JSON.parse(JSON.stringify(scan)) as typeof scan
    const probe = requireAbsent(join(userData, 'agent-probe.log'), 'AGENT_PROBE_LOG')

    expect(JSON.stringify(publicValues).includes(sentinels.ai)).toBe(false)
    expect(JSON.stringify(publicValues).includes(sentinels.feishu)).toBe(false)
    expect(JSON.stringify(publicValues).includes(sentinels.agent)).toBe(false)
    expect(JSON.stringify(ipcValues).includes(sentinels.ai)).toBe(false)
    expect(JSON.stringify(ipcValues).includes(sentinels.feishu)).toBe(false)
    expect(JSON.stringify(ipcValues).includes(sentinels.agent)).toBe(false)
    expect(JSON.stringify(ipcValues).includes(sentinels.douyin)).toBe(false)
    expect(JSON.stringify(ipcValues).includes(connectRequest.appSecret)).toBe(false)
    expect(JSON.stringify(child).includes(parentOnly)).toBe(false)
    expect(JSON.stringify(child).includes(agentToken)).toBe(false)
    expect(childOutput.parent).toBe(false)
    expect(childOutput.mcp.includes('[REDACTED]')).toBe(true)
    expect(child.stderr.includes('[REDACTED]')).toBe(true)
    expect(readFileSync(join(browserProfile, 'marker')).includes(sentinels.douyin)).toBe(true)
    expect(connectFeishuCustomApp).toHaveBeenCalledOnce()
    expect(JSON.stringify(captured).includes(connectRequest.appSecret)).toBe(false)
    expect(secure.ciphertexts.some((cipher) => Object.values(sentinels).some((sentinel) => cipher.includes(sentinel)))).toBe(false)
    expect(requiredMediaFiles.every((path) => existsSync(path) && statSync(path).size > 0)).toBe(true)
    expect(JSON.stringify(auditResults) === JSON.stringify(scan)).toBe(true)
    expect(auditResults.every((result) => result.status !== 'SCAN_FAILED')).toBe(true)
    const sqliteMain = auditResults.find((result) => result.ruleId === 'SQLITE_MAIN')
    expect(sqliteMain?.status === 'PRODUCED').toBe(true)
    expect(sqliteMain?.present === true).toBe(true)
    expect(sqliteMain?.passed === true).toBe(true)
    for (const rule of sqliteMedia.filter((item) => item.ruleId !== 'SQLITE_MAIN')) {
      const result = auditResults.find((item) => item.ruleId === rule.ruleId)
      const present = existsSync(rule.path)
      expect(result?.present === present).toBe(true)
      if (present) {
        expect(result?.status === 'PRODUCED').toBe(true)
        expect(result?.passed === true).toBe(true)
      } else {
        expect(result?.status === 'NOT_PRODUCED').toBe(true)
        expect(result?.passed === null).toBe(true)
      }
    }
    const nonSqliteMedia = auditResults.filter((result) => !result.ruleId.startsWith('SQLITE_'))
    expect(nonSqliteMedia.every((result) => result.status === 'PRODUCED' && result.present && result.passed === true)).toBe(true)
    expect(probe.status === 'NOT_PRODUCED').toBe(true)
    expect(probe.passed).toBe(true)
    expect(probe.present).toBe(false)
    expect(repositories.settings.get<string>(`secret.ai.profile.${profile.id}`)?.includes(sentinels.ai)).toBe(false)
    expect(repositories.settings.get<string>('secret.feishu.customApp')?.includes(sentinels.feishu)).toBe(false)
    expect(repositories.settings.get<string>('secret.agent.accessToken')?.includes(sentinels.agent)).toBe(false)
    database.close()
  }, 30_000)

  it('fails closed when secure storage is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'privacy-sentinel-unavailable-'))
    tempRoots.push(root)
    const database = new AppDatabase(join(root, 'content-radar.db'))
    databases.push(database)
    const repositories = new AppRepositories(database.connection)
    const secrets = new SecretStore(repositories.settings)
    const sentinels = [`ai-${randomUUID()}`, `feishu-${randomUUID()}`, `agent-${randomUUID()}`]
    const modelProfiles = new ModelProfileService({ profiles: repositories.modelProfiles, settings: repositories.settings, secrets })
    const agentAccess = new AgentAccessService({ settings: repositories.settings, secrets }, {
      randomBytes: () => Buffer.from(sentinels[2], 'utf8')
    })
    secure.state.available = false

    expect(() => modelProfiles.create(profileInput, sentinels[0])).toThrow('SECURE_STORAGE_UNAVAILABLE')
    expect(() => secrets.set('feishu.customApp', JSON.stringify({ appId: 'cli_privacy', appSecret: sentinels[1] }))).toThrow('SECURE_STORAGE_UNAVAILABLE')
    expect(() => agentAccess.resetToken()).toThrow('SECURE_STORAGE_UNAVAILABLE')
    expect(repositories.settings.get('secret.feishu.customApp')).toBeNull()
    expect(repositories.settings.get('secret.agent.accessToken')).toBeNull()
    expect(repositories.modelProfiles.list()).toEqual([])
    database.close()
  })
})

function ipcDependencies(options: {
  modelProfiles: ModelProfileService
  getFeishuConnection: () => Promise<ReturnType<FeishuIntegration['getConnection']>>
  agentStatus: () => unknown
  connectFeishuCustomApp: IpcDependencies['connectFeishuCustomApp']
}): IpcDependencies {
  const unused = async () => undefined
  return {
    getDashboard: unused as IpcDependencies['getDashboard'], runNow: unused as IpcDependencies['runNow'], listRuns: unused as IpcDependencies['listRuns'],
    retryRun: unused as IpcDependencies['retryRun'], retryFailedCreators: unused as IpcDependencies['retryFailedCreators'], deleteRun: unused as IpcDependencies['deleteRun'],
    listCreators: unused as IpcDependencies['listCreators'], addCreator: unused as IpcDependencies['addCreator'], deleteCreator: unused as IpcDependencies['deleteCreator'], toggleCreator: unused as IpcDependencies['toggleCreator'],
    clearUnclassifiedWorks: unused, loginDouyin: unused, logoutDouyin: unused, checkDouyinLogin: unused as IpcDependencies['checkDouyinLogin'],
    getSettings: unused as IpcDependencies['getSettings'], saveSettings: unused as IpcDependencies['saveSettings'], restoreRecommendedBehaviorSettings: unused as IpcDependencies['restoreRecommendedBehaviorSettings'],
    startImport: unused as IpcDependencies['startImport'], retryImport: unused as IpcDependencies['retryImport'], deleteFailedWork: unused as IpcDependencies['deleteFailedWork'],
    listWorks: unused as IpcDependencies['listWorks'], getWork: unused as IpcDependencies['getWork'], analyzeWork: unused as IpcDependencies['analyzeWork'],
    getFeishuConnection: options.getFeishuConnection, connectFeishuCustomApp: options.connectFeishuCustomApp, disconnectFeishu: unused, syncFeishu: async () => options.getFeishuConnection(),
    repairFeishu: unused as IpcDependencies['repairFeishu'], recreateFeishu: unused as IpcDependencies['recreateFeishu'], openFeishuBase: unused, openFeishuDeveloperConsole: unused,
    modelProfiles: options.modelProfiles,
    agentManager: { getStatus: options.agentStatus } as IpcDependencies['agentManager']
  }
}
