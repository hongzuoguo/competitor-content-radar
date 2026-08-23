import { describe, expect, it, vi } from 'vitest'
import { FeishuHttpClient } from '../../src/services/feishu/client'
import { FeishuSyncCoordinator } from '../../src/services/feishu/sync-coordinator'

function settingsStore(initial?: unknown) {
  let value = initial
  return {
    get: <T>() => (value as T | undefined) ?? null,
    set: (_key: string, next: unknown) => { value = next },
    saved: () => value
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('FeishuSyncCoordinator', () => {
  it('defaults to auto mode with no pending changes', () => {
    const coordinator = new FeishuSyncCoordinator(settingsStore(), async () => undefined)

    expect(coordinator.getState()).toMatchObject({
      mode: 'auto', localRevision: 0, syncedRevision: 0, hasPendingChanges: false
    })
  })

  it('treats a persisted synced revision ahead of local revision as pending work', () => {
    const coordinator = new FeishuSyncCoordinator(settingsStore({
      mode: 'auto', localRevision: 2, syncedRevision: 3
    }), async () => undefined)

    expect(coordinator.getState()).toMatchObject({
      mode: 'auto', localRevision: 2, syncedRevision: 0, hasPendingChanges: true
    })
  })

  it('treats a persisted state with a missing local revision as pending work', () => {
    const coordinator = new FeishuSyncCoordinator(settingsStore({
      mode: 'manual', syncedRevision: 0
    }), async () => undefined)

    expect(coordinator.getState()).toMatchObject({
      mode: 'manual', localRevision: 1, syncedRevision: 0, hasPendingChanges: true
    })
  })

  it('recovers from a settings read error into manual mode and does not auto-flush', async () => {
    let saved: unknown
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const settings = {
      get: <T>() => { throw new Error('invalid JSON') as T },
      set: (_key: string, value: unknown) => { saved = value }
    }

    const coordinator = new FeishuSyncCoordinator(settings, syncAll)

    expect(coordinator.getState()).toMatchObject({
      mode: 'manual', localRevision: 1, syncedRevision: 0, hasPendingChanges: true
    })
    expect(saved).toMatchObject({ mode: 'manual', localRevision: 1, syncedRevision: 0 })
    await coordinator.flushAfterTask()
    expect(syncAll).not.toHaveBeenCalled()
  })

  it('recovers from a top-level damaged record into manual mode and does not auto-flush', async () => {
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const coordinator = new FeishuSyncCoordinator(settingsStore('damaged state'), syncAll)

    expect(coordinator.getState()).toMatchObject({
      mode: 'manual', localRevision: 1, syncedRevision: 0, hasPendingChanges: true
    })
    await coordinator.flushAfterTask()
    expect(syncAll).not.toHaveBeenCalled()
  })

  it('flushes local changes at the end of an automatic task', async () => {
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const coordinator = new FeishuSyncCoordinator(settingsStore(), syncAll)

    coordinator.markLocalChange()
    await coordinator.flushAfterTask()

    expect(syncAll).toHaveBeenCalledOnce()
    expect(coordinator.getState()).toMatchObject({
      localRevision: 1, syncedRevision: 1, hasPendingChanges: false, lastErrorCode: null
    })
  })

  it('does not flush task changes while in manual mode', async () => {
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const coordinator = new FeishuSyncCoordinator(settingsStore(), syncAll)

    coordinator.setMode('manual')
    coordinator.markLocalChange()
    await coordinator.flushAfterTask()

    expect(syncAll).not.toHaveBeenCalled()
    expect(coordinator.getState().hasPendingChanges).toBe(true)
  })

  it('retains its previous mode when persistence fails', () => {
    let failWrites = false
    const store = settingsStore()
    const originalSet = store.set
    store.set = (key, value) => {
      if (failWrites) throw new Error('SETTINGS_WRITE_FAILED')
      originalSet(key, value)
    }
    const coordinator = new FeishuSyncCoordinator(store, async () => undefined)
    failWrites = true

    expect(() => coordinator.setMode('manual')).toThrow('SETTINGS_WRITE_FAILED')
    expect(coordinator.getState().mode).toBe('auto')
  })

  it('retains pending changes and persists only a stable error code after a failed sync', async () => {
    const store = settingsStore()
    const coordinator = new FeishuSyncCoordinator(store, async () => {
      throw new Error('Bearer secret-token must never be saved')
    })

    coordinator.markLocalChange()
    await expect(coordinator.flushAfterTask()).rejects.toThrow('Bearer secret-token must never be saved')

    expect(coordinator.getState()).toMatchObject({
      syncedRevision: 0, hasPendingChanges: true, lastErrorCode: 'FEISHU_SYNC_FAILED'
    })
    expect(JSON.stringify(store.saved())).not.toContain('secret-token')
  })

  it('does not persist an arbitrary uppercase error message as an error code', async () => {
    const coordinator = new FeishuSyncCoordinator(settingsStore(), async () => {
      throw new Error('APP_SECRET_TOKEN')
    })

    coordinator.markLocalChange()
    await expect(coordinator.flushAfterTask()).rejects.toThrow('APP_SECRET_TOKEN')

    expect(coordinator.getState().lastErrorCode).toBe('FEISHU_SYNC_FAILED')
  })

  it('stores only the trusted prefix of a Feishu API error', async () => {
    const store = settingsStore()
    const coordinator = new FeishuSyncCoordinator(store, async () => {
      throw new Error('FEISHU_API_1254302: Bearer secret-token')
    })

    coordinator.markLocalChange()
    await expect(coordinator.flushAfterTask()).rejects.toThrow('FEISHU_API_1254302')

    expect(coordinator.getState().lastErrorCode).toBe('FEISHU_API_1254302')
    expect(JSON.stringify(store.saved())).not.toContain('secret-token')
  })

  it('persists the stable code from a real Feishu client API failure', async () => {
    const client = new FeishuHttpClient('test-access-token', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 999,
      msg: 'fake-response-secret'
    }), { status: 200 })) as typeof fetch)
    const coordinator = new FeishuSyncCoordinator(settingsStore(), () => client.resolveWikiNode('wikcn123'))

    coordinator.markLocalChange()
    await expect(coordinator.flushAfterTask()).rejects.toThrow('FEISHU_API_999:wiki.node')

    expect(coordinator.getState().lastErrorCode).toBe('FEISHU_API_999')
  })

  it('persists the primary code from a real HTTP failure with safe metadata', async () => {
    const client = new FeishuHttpClient('test-access-token', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 1254001,
      msg: 'fake-response-secret',
      error: { log_id: 'log-123' }
    }), { status: 403 })) as typeof fetch)
    const coordinator = new FeishuSyncCoordinator(settingsStore(), () => client.resolveWikiNode('wikcn123'))

    coordinator.markLocalChange()
    await expect(coordinator.flushAfterTask()).rejects.toThrow(
      'FEISHU_API_1254001:HTTP_403 GET wiki.node REQUEST_ID_log-123'
    )

    expect(coordinator.getState().lastErrorCode).toBe('FEISHU_API_1254001')
  })

  it('persists the HTTP fallback code from a real response without a Feishu code', async () => {
    const client = new FeishuHttpClient('test-access-token', vi.fn().mockResolvedValue(
      new Response('{}', { status: 404 })
    ) as typeof fetch)
    const coordinator = new FeishuSyncCoordinator(settingsStore(), () => client.resolveWikiNode('wikcn123'))

    coordinator.markLocalChange()
    await expect(coordinator.flushAfterTask()).rejects.toThrow('FEISHU_HTTP_404:GET wiki.node')

    expect(coordinator.getState().lastErrorCode).toBe('FEISHU_HTTP_404')
  })

  it('allows a failed sync to be retried after its in-flight promise rejects', async () => {
    const syncAll = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined)
    const coordinator = new FeishuSyncCoordinator(settingsStore(), syncAll)

    coordinator.markLocalChange()
    await expect(coordinator.flushAfterTask()).rejects.toThrow('temporary failure')
    coordinator.markLocalChange()
    await coordinator.flushAfterTask()

    expect(syncAll).toHaveBeenCalledTimes(2)
    expect(coordinator.getState()).toMatchObject({ localRevision: 2, syncedRevision: 2, hasPendingChanges: false })
  })

  it('runs syncNow in manual mode even without pending local changes', async () => {
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const coordinator = new FeishuSyncCoordinator(settingsStore(), syncAll)

    coordinator.setMode('manual')
    await coordinator.syncNow()

    expect(syncAll).toHaveBeenCalledOnce()
    expect(coordinator.getState()).toMatchObject({
      mode: 'manual', hasPendingChanges: false,
      lastSyncAttemptAt: expect.any(String), lastSyncSucceededAt: expect.any(String)
    })
  })

  it('only marks the revision captured at sync start when a new change arrives during sync', async () => {
    const pending = deferred()
    const coordinator = new FeishuSyncCoordinator(settingsStore(), async () => pending.promise)

    coordinator.markLocalChange()
    const flush = coordinator.flushAfterTask()
    coordinator.markLocalChange()
    pending.resolve()
    await flush

    expect(coordinator.getState()).toMatchObject({
      localRevision: 2, syncedRevision: 1, hasPendingChanges: true
    })
  })

  it('queues one compensating flush for all task boundaries that arrive during a sync', async () => {
    const pending = deferred()
    const syncAll = vi.fn()
      .mockImplementationOnce(async () => pending.promise)
      .mockResolvedValueOnce(undefined)
    const coordinator = new FeishuSyncCoordinator(settingsStore(), syncAll)

    coordinator.markLocalChange()
    const first = coordinator.flushAfterTask()
    coordinator.markLocalChange()
    const secondBoundary = coordinator.flushAfterTask()
    const thirdBoundary = coordinator.flushAfterTask()
    pending.resolve()
    await Promise.all([first, secondBoundary, thirdBoundary])

    expect(syncAll).toHaveBeenCalledTimes(2)
    expect(coordinator.getState()).toMatchObject({
      localRevision: 2, syncedRevision: 2, hasPendingChanges: false
    })
  })

  it('shares concurrent flushes instead of running duplicate syncs', async () => {
    const pending = deferred()
    const syncAll = vi.fn(async () => pending.promise)
    const coordinator = new FeishuSyncCoordinator(settingsStore(), syncAll)

    coordinator.markLocalChange()
    const first = coordinator.flushAfterTask()
    const second = coordinator.flushAfterTask()
    pending.resolve()
    await Promise.all([first, second])

    expect(syncAll).toHaveBeenCalledOnce()
  })
})
