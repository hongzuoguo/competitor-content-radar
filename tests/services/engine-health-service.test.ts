import { describe, expect, it, vi } from 'vitest'
import {
  EngineHealthService,
  type EngineHealthProbeResult
} from '../../src/services/ai/engine-health-service'

class MemorySettings {
  private readonly values = new Map<string, unknown>()
  readonly writes: unknown[] = []

  get<T>(key: string): T | null {
    return (this.values.get(key) as T | undefined) ?? null
  }

  set(key: string, value: unknown): void {
    this.values.set(key, structuredClone(value))
    this.writes.push(structuredClone(value))
  }

  dump(): Record<string, unknown> {
    return Object.fromEntries(this.values)
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function createService(overrides: {
  settings?: MemorySettings
  cloudFingerprint?: () => string | null | Promise<string | null>
  codexFingerprint?: () => string | null | Promise<string | null>
  probeCloud?: () => Promise<EngineHealthProbeResult>
  probeCodex?: () => Promise<EngineHealthProbeResult>
} = {}) {
  const settings = overrides.settings ?? new MemorySettings()
  const probeCloud = vi.fn(overrides.probeCloud ?? (async () => ({ ok: true })))
  const probeCodex = vi.fn(overrides.probeCodex ?? (async () => ({ ok: true })))
  const service = new EngineHealthService({
    settings,
    cloud: {
      fingerprint: overrides.cloudFingerprint ?? (() => 'cloud-v1'),
      probe: probeCloud
    },
    codex: {
      fingerprint: overrides.codexFingerprint ?? (() => 'codex-v1'),
      probe: probeCodex
    },
    now: () => '2026-08-09T12:00:00.000Z'
  })
  return { service, settings, probeCloud, probeCodex }
}

describe('EngineHealthService', () => {
  it('returns unknown entries before any explicit refresh', async () => {
    const { service } = createService()

    await expect(service.get()).resolves.toEqual({
      cloud: { status: 'unknown', checkedAt: null, fingerprint: 'cloud-v1', code: null, message: null },
      codex: { status: 'unknown', checkedAt: null, fingerprint: 'codex-v1', code: null, message: null },
      checking: false
    })
  })

  it('peeks at normalized persisted state without resolving fingerprints or running probes', () => {
    const settings = new MemorySettings()
    settings.set('engine.health.v1', {
      cloud: { status: 'healthy', checkedAt: '2026-08-09T12:00:00.000Z', fingerprint: 'cloud-v1', code: null, message: null },
      codex: { status: 'unknown', checkedAt: null, fingerprint: 'codex-v1', code: null, message: null },
      checking: false
    })
    const cloudFingerprint = vi.fn(() => 'cloud-v1')
    const codexFingerprint = vi.fn(() => 'codex-v1')
    const { service, probeCloud, probeCodex } = createService({ settings, cloudFingerprint, codexFingerprint })

    expect(service.peekPersisted()).toEqual({
      cloud: { status: 'healthy', checkedAt: '2026-08-09T12:00:00.000Z', fingerprint: 'cloud-v1', code: null, message: null },
      codex: { status: 'unknown', checkedAt: null, fingerprint: 'codex-v1', code: null, message: null },
      checking: false
    })
    expect(cloudFingerprint).not.toHaveBeenCalled()
    expect(codexFingerprint).not.toHaveBeenCalled()
    expect(probeCloud).not.toHaveBeenCalled()
    expect(probeCodex).not.toHaveBeenCalled()
  })

  it('persists healthy entries after both probes succeed', async () => {
    const { service, settings } = createService()

    await expect(service.refreshAll()).resolves.toMatchObject({
      cloud: { status: 'healthy', fingerprint: 'cloud-v1', checkedAt: '2026-08-09T12:00:00.000Z' },
      codex: { status: 'healthy', fingerprint: 'codex-v1', checkedAt: '2026-08-09T12:00:00.000Z' },
      checking: false
    })
    expect(settings.writes).toContainEqual(expect.objectContaining({ checking: true }))
    expect(JSON.stringify(settings.dump())).toContain('healthy')
  })

  it('keeps a successful engine healthy when the other probe fails', async () => {
    const { service, settings } = createService({
      probeCodex: async () => ({ ok: false, code: 'CODEX_LOGIN_REQUIRED' })
    })

    await expect(service.refreshAll()).resolves.toMatchObject({
      cloud: { status: 'healthy', code: null, message: null },
      codex: { status: 'unhealthy', code: 'CODEX_LOGIN_REQUIRED', message: 'Codex 尚未登录，请先在终端完成登录。' },
      checking: false
    })
  })

  it('keeps the stable generic Codex connection code without persisting CLI output', async () => {
    const { service } = createService({
      probeCodex: async () => ({ ok: false, code: 'CODEX_CONNECTION_FAILED', message: 'stderr: private output' })
    })

    await expect(service.refreshAll()).resolves.toMatchObject({
      codex: { status: 'unhealthy', code: 'CODEX_CONNECTION_FAILED', message: 'Codex 连接检测失败，请检查网络和登录状态后重试。' }
    })
  })

  it('returns unknown for a persisted entry from a different effective configuration', async () => {
    let cloudFingerprint = 'cloud-v1'
    const { service } = createService({ cloudFingerprint: () => cloudFingerprint })
    await service.refreshAll()
    cloudFingerprint = 'cloud-v2'

    await expect(service.get()).resolves.toMatchObject({
      cloud: { status: 'unknown', fingerprint: 'cloud-v2', checkedAt: null, code: null, message: null },
      codex: { status: 'healthy', fingerprint: 'codex-v1' }
    })
  })

  it('invalidates only the requested engine immediately', async () => {
    const { service } = createService()
    await service.refreshAll()

    await service.invalidateCloud()

    await expect(service.get()).resolves.toMatchObject({
      cloud: { status: 'unknown', checkedAt: null, code: null, message: null },
      codex: { status: 'healthy' }
    })
  })

  it('makes a fire-and-forget invalidation visible to peek before its fingerprint resolves', async () => {
    const pendingFingerprint = deferred<string>()
    let deferFingerprint = false
    const { service } = createService({
      cloudFingerprint: () => deferFingerprint ? pendingFingerprint.promise : 'cloud-v1'
    })
    await service.refreshAll()
    deferFingerprint = true

    const invalidation = service.invalidateCloud()

    expect(service.peekPersisted()).toEqual({
      cloud: { status: 'unknown', checkedAt: null, fingerprint: null, code: null, message: null },
      codex: { status: 'healthy', checkedAt: '2026-08-09T12:00:00.000Z', fingerprint: 'codex-v1', code: null, message: null },
      checking: false
    })

    pendingFingerprint.resolve('cloud-v2')
    await invalidation
    expect(service.peekPersisted()).toMatchObject({
      cloud: { status: 'unknown', fingerprint: 'cloud-v2' },
      codex: { status: 'healthy', fingerprint: 'codex-v1' }
    })
  })

  it('records an explicitly verified cloud result for the current fingerprint without probing either engine', async () => {
    const { service, probeCloud, probeCodex } = createService()

    await expect(service.recordCloudSuccess()).resolves.toMatchObject({
      cloud: { status: 'healthy', fingerprint: 'cloud-v1', checkedAt: '2026-08-09T12:00:00.000Z' },
      codex: { status: 'unknown', fingerprint: 'codex-v1' },
      checking: false
    })
    expect(probeCloud).not.toHaveBeenCalled()
    expect(probeCodex).not.toHaveBeenCalled()
  })

  it('keeps a peer Codex refresh in checking state when recording cloud success', async () => {
    const cloud = deferred<EngineHealthProbeResult>()
    const codex = deferred<EngineHealthProbeResult>()
    const { service } = createService({ probeCloud: () => cloud.promise, probeCodex: () => codex.promise })
    const refresh = service.refreshAll()
    await expect(service.get()).resolves.toMatchObject({ codex: { status: 'checking' }, checking: true })

    await expect(service.recordCloudSuccess()).resolves.toMatchObject({
      cloud: { status: 'healthy' }, codex: { status: 'checking' }, checking: true
    })
    cloud.resolve({ ok: true })
    codex.resolve({ ok: true })
    await refresh
  })

  it('does not let an older invalidation overwrite a later verified cloud success', async () => {
    const staleFingerprint = deferred<string>()
    let cloudFingerprintCalls = 0
    const { service } = createService({
      cloudFingerprint: () => (++cloudFingerprintCalls === 3 ? staleFingerprint.promise : 'cloud-v1')
    })
    await service.refreshAll()

    const invalidation = service.invalidateCloud()
    await expect(service.recordCloudSuccess()).resolves.toMatchObject({ cloud: { status: 'healthy' } })
    staleFingerprint.resolve('cloud-v1')
    await invalidation

    await expect(service.get()).resolves.toMatchObject({ cloud: { status: 'healthy' } })
  })

  it('returns unknown rather than a stale checking entry when invalidation is still resolving its fingerprint', async () => {
    const staleFingerprint = deferred<string>()
    const cloudProbe = deferred<EngineHealthProbeResult>()
    const codexProbe = deferred<EngineHealthProbeResult>()
    let cloudFingerprintCalls = 0
    const { service, settings } = createService({
      cloudFingerprint: () => (++cloudFingerprintCalls === 2 ? staleFingerprint.promise : 'cloud-v1'),
      probeCloud: () => cloudProbe.promise,
      probeCodex: () => codexProbe.promise
    })
    const refresh = service.refreshAll()
    await vi.waitFor(() => expect(settings.writes).toContainEqual(expect.objectContaining({ checking: true })))
    const invalidation = service.invalidateCloud()
    cloudProbe.resolve({ ok: true })
    codexProbe.resolve({ ok: true })

    await expect(refresh).resolves.toMatchObject({
      cloud: { status: 'unknown', checkedAt: null, code: null, message: null },
      codex: { status: 'healthy' },
      checking: false
    })
    staleFingerprint.resolve('cloud-v1')
    await invalidation
  })

  it('persists only stable failure details and never secret probe data', async () => {
    const { service, settings } = createService({
      probeCloud: async () => ({
        ok: false,
        code: 'sk-test-secret',
        message: 'Authorization: Bearer sk-test-secret, raw response: private'
      })
    })

    await expect(service.refreshAll()).resolves.toMatchObject({
      cloud: { status: 'unhealthy', code: 'ENGINE_CHECK_FAILED', message: '检测失败，请检查配置后重试。' }
    })
    expect(JSON.stringify(settings.dump())).not.toContain('sk-test-secret')
    expect(JSON.stringify(settings.dump())).not.toContain('Bearer')
    expect(JSON.stringify(settings.dump())).not.toContain('raw response')
  })

  it('normalizes a thrown raw probe error without persisting its contents', async () => {
    const { service, settings } = createService({
      probeCodex: async () => { throw new Error('stderr: Bearer sk-test-secret') }
    })

    await expect(service.refreshAll()).resolves.toMatchObject({
      codex: { status: 'unhealthy', code: 'ENGINE_CHECK_FAILED', message: '检测失败，请检查配置后重试。' }
    })
    expect(JSON.stringify(settings.dump())).not.toContain('sk-test-secret')
    expect(JSON.stringify(settings.dump())).not.toContain('stderr')
  })

  it('reports persisted checking state while a refresh is in flight', async () => {
    const cloud = deferred<EngineHealthProbeResult>()
    const codex = deferred<EngineHealthProbeResult>()
    const { service } = createService({ probeCloud: () => cloud.promise, probeCodex: () => codex.promise })

    const refresh = service.refreshAll()
    await expect(service.get()).resolves.toMatchObject({
      cloud: { status: 'checking', fingerprint: 'cloud-v1' },
      codex: { status: 'checking', fingerprint: 'codex-v1' },
      checking: true
    })

    cloud.resolve({ ok: true })
    codex.resolve({ ok: true })
    await refresh
  })

  it('recovers an interrupted persisted refresh as unknown after restart', async () => {
    const settings = new MemorySettings()
    settings.set('engine.health.v1', {
      cloud: { status: 'checking', checkedAt: null, fingerprint: 'cloud-v1', code: null, message: null },
      codex: { status: 'checking', checkedAt: null, fingerprint: 'codex-v1', code: null, message: null },
      checking: true
    })
    const { service } = createService({ settings })

    await expect(service.get()).resolves.toEqual({
      cloud: { status: 'unknown', checkedAt: null, fingerprint: 'cloud-v1', code: null, message: null },
      codex: { status: 'unknown', checkedAt: null, fingerprint: 'codex-v1', code: null, message: null },
      checking: false
    })
  })

  it('keeps an invalidated engine unknown while its unaffected peer finishes', async () => {
    const cloud = deferred<EngineHealthProbeResult>()
    const codex = deferred<EngineHealthProbeResult>()
    const { service } = createService({ probeCloud: () => cloud.promise, probeCodex: () => codex.promise })

    const refresh = service.refreshAll()
    await service.invalidateCloud()
    cloud.resolve({ ok: true })
    codex.resolve({ ok: true })

    await expect(refresh).resolves.toEqual({
      cloud: { status: 'unknown', checkedAt: null, fingerprint: 'cloud-v1', code: null, message: null },
      codex: { status: 'healthy', checkedAt: '2026-08-09T12:00:00.000Z', fingerprint: 'codex-v1', code: null, message: null },
      checking: false
    })
  })

  it('does not overwrite a peer result when refresh completes during invalidation', async () => {
    const cloud = deferred<EngineHealthProbeResult>()
    const codex = deferred<EngineHealthProbeResult>()
    const { service } = createService({ probeCloud: () => cloud.promise, probeCodex: () => codex.promise })
    const refresh = service.refreshAll()
    const staleSnapshot = await service.get()
    const delayedGet = deferred<typeof staleSnapshot>()
    const get = vi.spyOn(service, 'get').mockReturnValueOnce(delayedGet.promise)

    const invalidation = service.invalidateCloud()
    cloud.resolve({ ok: true })
    codex.resolve({ ok: true })
    await expect(refresh).resolves.toMatchObject({
      cloud: { status: 'unknown' },
      codex: { status: 'healthy' },
      checking: false
    })

    delayedGet.resolve(staleSnapshot)
    await invalidation
    get.mockRestore()

    await expect(service.get()).resolves.toMatchObject({
      cloud: { status: 'unknown' },
      codex: { status: 'healthy' },
      checking: false
    })
  })

  it('normalizes persisted entries instead of trusting stored codes, messages, or timestamps', async () => {
    const settings = new MemorySettings()
    settings.set('engine.health.v1', {
      cloud: {
        status: 'unhealthy', checkedAt: '2026-08-09T12:00:00.000Z', fingerprint: 'cloud-v1',
        code: 'sk-test-secret', message: 'Authorization: Bearer sk-test-secret'
      },
      codex: {
        status: 'healthy', checkedAt: 'yesterday', fingerprint: 'codex-v1',
        code: 'CODEX_LOGIN_REQUIRED', message: 'not canonical'
      },
      checking: false
    })
    const { service } = createService({ settings })

    await expect(service.get()).resolves.toEqual({
      cloud: {
        status: 'unhealthy', checkedAt: '2026-08-09T12:00:00.000Z', fingerprint: 'cloud-v1',
        code: 'ENGINE_CHECK_FAILED', message: '检测失败，请检查配置后重试。'
      },
      codex: { status: 'unknown', checkedAt: null, fingerprint: 'codex-v1', code: null, message: null },
      checking: false
    })
  })

  it('shares one in-flight refresh across repeated clicks', async () => {
    const cloud = deferred<EngineHealthProbeResult>()
    const codex = deferred<EngineHealthProbeResult>()
    const { service, probeCloud, probeCodex } = createService({
      probeCloud: () => cloud.promise,
      probeCodex: () => codex.promise
    })

    const first = service.refreshAll()
    const second = service.refreshAll()
    expect(second).toBe(first)
    await vi.waitFor(() => {
      expect(probeCloud).toHaveBeenCalledTimes(1)
      expect(probeCodex).toHaveBeenCalledTimes(1)
    })

    cloud.resolve({ ok: true })
    codex.resolve({ ok: true })
    await expect(first).resolves.toMatchObject({ checking: false })
  })
})
