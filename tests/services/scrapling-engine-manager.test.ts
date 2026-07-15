import { describe, expect, it, vi } from 'vitest'
import { ScraplingEngineManager } from '../../src/services/scrapling-engine/manager'

const manifest = {
  protocolVersion: 1 as const,
  version: '0.1.0',
  platform: 'win32' as const,
  arch: 'x64' as const,
  url: 'https://github.com/hongzuoguo/competitor-content-radar/releases/download/scrapling-engine-v0.1.0/scrapling-engine-win32-x64.zip',
  sha256: 'a'.repeat(64),
  size: 80_000_000
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    loadManifest: vi.fn().mockResolvedValue(manifest),
    readActiveVersion: vi.fn().mockResolvedValue(null),
    download: vi.fn().mockResolvedValue(undefined),
    sha256: vi.fn().mockResolvedValue(manifest.sha256),
    extract: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(undefined),
    promote: vi.fn().mockResolvedValue(undefined),
    activate: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('ScraplingEngineManager', () => {
  it('reuses an active compatible engine without downloading', async () => {
    const deps = dependencies({ readActiveVersion: vi.fn().mockResolvedValue('0.1.0') })
    const manager = new ScraplingEngineManager('C:\\Data\\components', deps)

    await expect(manager.ensureInstalled()).resolves.toBe('C:\\Data\\components\\scrapling\\0.1.0\\scrapling-engine.exe')
    expect(deps.download).not.toHaveBeenCalled()
  })

  it('keeps using an installed engine when the manifest is temporarily offline', async () => {
    const deps = dependencies({
      readActiveVersion: vi.fn().mockResolvedValue('0.1.0'),
      loadManifest: vi.fn().mockRejectedValue(new Error('offline'))
    })
    const manager = new ScraplingEngineManager('C:\\Data\\components', deps)

    await expect(manager.ensureInstalled()).resolves.toBe('C:\\Data\\components\\scrapling\\0.1.0\\scrapling-engine.exe')
    expect(deps.download).not.toHaveBeenCalled()
  })

  it('downloads, verifies, extracts, health checks and activates in order', async () => {
    const calls: string[] = []
    const deps = dependencies({
      download: vi.fn(async () => { calls.push('download') }),
      sha256: vi.fn(async () => { calls.push('hash'); return manifest.sha256 }),
      extract: vi.fn(async () => { calls.push('extract') }),
      healthCheck: vi.fn(async () => { calls.push('health') }),
      activate: vi.fn(async () => { calls.push('activate') })
    })
    const manager = new ScraplingEngineManager('C:\\Data\\components', deps)

    await manager.ensureInstalled()
    expect(calls).toEqual(['download', 'hash', 'extract', 'health', 'activate'])
  })

  it('does not extract or activate an archive with the wrong hash', async () => {
    const deps = dependencies({ sha256: vi.fn().mockResolvedValue('b'.repeat(64)) })
    const manager = new ScraplingEngineManager('C:\\Data\\components', deps)

    await expect(manager.ensureInstalled()).rejects.toMatchObject({ code: 'SCRAPLING_ENGINE_HASH_MISMATCH' })
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.activate).not.toHaveBeenCalled()
  })

  it('does not activate an engine that fails its health check', async () => {
    const deps = dependencies({ healthCheck: vi.fn().mockRejectedValue(new Error('bad engine')) })
    const manager = new ScraplingEngineManager('C:\\Data\\components', deps)

    await expect(manager.ensureInstalled()).rejects.toThrow('bad engine')
    expect(deps.activate).not.toHaveBeenCalled()
    expect(deps.remove).toHaveBeenCalled()
  })

  it('coalesces concurrent installation requests', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const deps = dependencies({ download: vi.fn(() => blocked) })
    const manager = new ScraplingEngineManager('C:\\Data\\components', deps)

    const first = manager.ensureInstalled()
    const second = manager.ensureInstalled()
    release()
    await Promise.all([first, second])
    expect(deps.download).toHaveBeenCalledTimes(1)
  })
})
