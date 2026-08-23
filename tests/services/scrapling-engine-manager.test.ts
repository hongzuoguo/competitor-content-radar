import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activateScraplingEnginePointer, ScraplingEngineManager } from '../../src/services/scrapling-engine/manager'

const manifest = {
  protocolVersion: 1 as const,
  version: '0.1.0',
  platform: 'win32' as const,
  arch: 'x64' as const,
  archive: {
    filename: 'scrapling-engine-win32-x64.zip',
    size: 80_000_000,
    sha256: 'a'.repeat(64)
  },
  sourceCommit: 'b'.repeat(40),
  pythonLockSha256: 'c'.repeat(64)
}
const finalDirectoryName = `${manifest.version}-${manifest.archive.sha256}`

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    readActiveVersion: vi.fn().mockResolvedValue(null),
    stageBundledArchive: vi.fn().mockResolvedValue(undefined),
    size: vi.fn().mockResolvedValue(manifest.archive.size),
    sha256: vi.fn().mockResolvedValue(manifest.archive.sha256),
    extract: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(undefined),
    promote: vi.fn().mockResolvedValue(undefined),
    activate: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('ScraplingEngineManager', () => {
  it('installs the embedded archive without using fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const calls: string[] = []
    const deps = dependencies({
      stageBundledArchive: vi.fn(async () => { calls.push('bundle') }),
      sha256: vi.fn(async () => { calls.push('hash'); return manifest.archive.sha256 }),
      extract: vi.fn(async () => { calls.push('extract') }),
      healthCheck: vi.fn(async () => { calls.push('health') }),
      activate: vi.fn(async () => { calls.push('activate') })
    })
    const manager = new ScraplingEngineManager(
      'C:\\Data\\components',
      { manifest, archivePath: 'C:\\Program Files\\ContentRadar\\scrapling.zip' },
      deps
    )

    try {
      await expect(manager.ensureInstalled()).resolves.toEqual({
        file: `C:\\Data\\components\\scrapling\\${finalDirectoryName}\\scrapling-engine.exe`,
        args: [], cwd: `C:\\Data\\components\\scrapling\\${finalDirectoryName}`
      })
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(calls).toEqual(['bundle', 'hash', 'extract', 'health', 'activate'])
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('reinstalls when the active version differs from the embedded version', async () => {
    const bundledManifest = { ...manifest, version: '0.1.1' }
    const deps = dependencies({
      readActiveVersion: vi.fn().mockResolvedValue('0.1.0'),
      stageBundledArchive: vi.fn().mockResolvedValue(undefined),
      sha256: vi.fn().mockResolvedValue(bundledManifest.archive.sha256)
    })
    const manager = new ScraplingEngineManager(
      'C:\\Data\\components',
      { manifest: bundledManifest, archivePath: 'C:\\Program Files\\ContentRadar\\scrapling.zip' },
      deps
    )

    await expect(manager.ensureInstalled()).resolves.toEqual({
      file: `C:\\Data\\components\\scrapling\\${bundledManifest.version}-${bundledManifest.archive.sha256}\\scrapling-engine.exe`,
      args: [], cwd: `C:\\Data\\components\\scrapling\\${bundledManifest.version}-${bundledManifest.archive.sha256}`
    })
    expect(deps.stageBundledArchive).toHaveBeenCalledTimes(1)
    expect(deps.activate).toHaveBeenCalledWith('0.1.1')
  })

  it('reuses the active engine only when it exactly matches the embedded version', async () => {
    const deps = dependencies({ readActiveVersion: vi.fn().mockResolvedValue('0.1.0') })
    const manager = new ScraplingEngineManager('C:\\Data\\components', {
      manifest, archivePath: 'C:\\Program Files\\ContentRadar\\scrapling.zip'
    }, deps)

    await expect(manager.ensureInstalled()).resolves.toEqual({
      file: `C:\\Data\\components\\scrapling\\${finalDirectoryName}\\scrapling-engine.exe`,
      args: [], cwd: `C:\\Data\\components\\scrapling\\${finalDirectoryName}`
    })
    expect(deps.stageBundledArchive).not.toHaveBeenCalled()
  })

  it('does not reuse an invalid active version', async () => {
    const invalidManifest = { ...manifest, version: '01.2.3' }
    const deps = dependencies({ readActiveVersion: vi.fn().mockResolvedValue('01.2.3') })
    const manager = new ScraplingEngineManager('C:\\Data\\components', {
      manifest: invalidManifest, archivePath: 'C:\\Program Files\\ContentRadar\\scrapling.zip'
    }, deps)

    await manager.ensureInstalled()
    expect(deps.stageBundledArchive).toHaveBeenCalledOnce()
  })

  it('does not reuse a legacy plain-version target for the current archive hash', async () => {
    const deps = dependencies({
      readActiveVersion: vi.fn((expected?: { file: string }) => Promise.resolve(
        expected ? null : manifest.version
      ))
    })
    const manager = new ScraplingEngineManager('C:\\Data\\components', {
      manifest, archivePath: 'C:\\Program Files\\ContentRadar\\scrapling.zip'
    }, deps)

    await manager.ensureInstalled()
    expect(deps.readActiveVersion).toHaveBeenCalledWith(expect.objectContaining({
      file: `C:\\Data\\components\\scrapling\\${finalDirectoryName}\\scrapling-engine.exe`
    }))
    expect(deps.stageBundledArchive).toHaveBeenCalledOnce()
  })

  it('gives concurrent managers unique staging destinations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scrapling-manager-'))
    let release!: () => void
    let entered = 0
    let bothEntered!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const ready = new Promise<void>((resolve) => { bothEntered = resolve })
    const destinations: string[] = []
    const stage = vi.fn(async (_source: string, destination: string) => {
      destinations.push(destination)
      entered += 1
      if (entered === 2) bothEntered()
      await blocked
    })
    const first = new ScraplingEngineManager(join(root, 'components'), {
      manifest, archivePath: 'C:\\Program Files\\ContentRadar\\scrapling.zip'
    }, dependencies({ stageBundledArchive: stage }))
    const second = new ScraplingEngineManager(join(root, 'components'), {
      manifest, archivePath: 'C:\\Program Files\\ContentRadar\\scrapling.zip'
    }, dependencies({ stageBundledArchive: stage }))

    try {
      const installing = [first.ensureInstalled(), second.ensureInstalled()]
      await ready
      expect(new Set(destinations).size).toBe(2)
      release()
      await Promise.all(installing)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('lets two managers reuse the same immutable promoted engine', async () => {
    let releaseFirst!: () => void
    let firstPromoted!: () => void
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve })
    const firstReady = new Promise<void>((resolve) => { firstPromoted = resolve })
    const firstRemovals: string[] = []
    const secondRemovals: string[] = []
    const first = new ScraplingEngineManager('C:\\Data\\components', {
      manifest, archivePath: 'C:\\Program Files\\ContentRadar\\scrapling.zip'
    }, dependencies({
      promote: vi.fn(async () => {
        firstPromoted()
        await firstBlocked
      }),
      remove: vi.fn(async (path: string) => { firstRemovals.push(path) })
    }))
    const secondHealth = vi.fn().mockResolvedValue(undefined)
    const second = new ScraplingEngineManager('C:\\Data\\components', {
      manifest, archivePath: 'C:\\Program Files\\ContentRadar\\scrapling.zip'
    }, dependencies({
      promote: vi.fn().mockRejectedValue(Object.assign(new Error('exists'), { code: 'EEXIST' })),
      healthCheck: secondHealth,
      remove: vi.fn(async (path: string) => { secondRemovals.push(path) })
    }))

    const firstInstalling = first.ensureInstalled()
    await firstReady
    const secondCommand = await second.ensureInstalled()
    releaseFirst()
    const firstCommand = await firstInstalling

    expect(secondHealth).toHaveBeenCalledTimes(2)
    expect(firstCommand.file).toBe(secondCommand.file)
    expect(firstCommand.file).toBe(`C:\\Data\\components\\scrapling\\${finalDirectoryName}\\scrapling-engine.exe`)
    for (const removed of [...firstRemovals, ...secondRemovals]) {
      expect(removed).not.toBe(`C:\\Data\\components\\scrapling\\${finalDirectoryName}`)
    }
  })

  it('fails when the embedded bundle is missing even if an old local engine is active', async () => {
    const deps = dependencies({ readActiveVersion: vi.fn().mockResolvedValue('0.1.0') })
    const manager = new ScraplingEngineManager('C:\\Data\\components', undefined, deps)

    await expect(manager.ensureInstalled()).rejects.toMatchObject({ code: 'SCRAPLING_ENGINE_BUNDLE_UNAVAILABLE' })
    expect(deps.stageBundledArchive).not.toHaveBeenCalled()
  })

  it('stages, verifies, extracts, health checks and activates the embedded archive in order', async () => {
    const calls: string[] = []
    const deps = dependencies({
      stageBundledArchive: vi.fn(async () => { calls.push('bundle') }),
      sha256: vi.fn(async () => { calls.push('hash'); return manifest.archive.sha256 }),
      extract: vi.fn(async () => { calls.push('extract') }),
      healthCheck: vi.fn(async () => { calls.push('health') }),
      activate: vi.fn(async () => { calls.push('activate') })
    })
    const manager = new ScraplingEngineManager('C:\\Data\\components', {
      manifest, archivePath: 'C:\\Program Files\\ContentRadar\\scrapling.zip'
    }, deps)

    await manager.ensureInstalled()
    expect(calls).toEqual(['bundle', 'hash', 'extract', 'health', 'activate'])
  })

  it('does not extract or activate an archive with the wrong hash', async () => {
    const deps = dependencies({ sha256: vi.fn().mockResolvedValue('b'.repeat(64)) })
    const manager = new ScraplingEngineManager('C:\\Data\\components', {
      manifest, archivePath: 'C:\\Program Files\\ContentRadar\\scrapling.zip'
    }, deps)

    await expect(manager.ensureInstalled()).rejects.toMatchObject({ code: 'SCRAPLING_ENGINE_HASH_MISMATCH' })
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.activate).not.toHaveBeenCalled()
  })

  it('does not hash, extract, or activate an archive with the wrong size', async () => {
    const deps = dependencies({ size: vi.fn().mockResolvedValue(manifest.archive.size - 1) })
    const manager = new ScraplingEngineManager('C:\\Data\\components', {
      manifest, archivePath: 'C:\\Program Files\\ContentRadar\\scrapling.zip'
    }, deps)

    await expect(manager.ensureInstalled()).rejects.toMatchObject({ code: 'SCRAPLING_ENGINE_SIZE_MISMATCH' })
    expect(deps.sha256).not.toHaveBeenCalled()
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.activate).not.toHaveBeenCalled()
    expect(deps.remove).toHaveBeenCalled()
  })

  it('keeps the old pointer and removes its temporary pointer when replacement fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scrapling-manager-'))
    const engineRoot = join(root, 'components', 'scrapling')
    await mkdir(engineRoot, { recursive: true })
    await writeFile(join(engineRoot, 'current.json'), JSON.stringify({ version: '0.0.9' }), 'utf8')
    const replace = vi.fn().mockRejectedValue(new Error('rename failed'))

    try {
      await expect(activateScraplingEnginePointer(engineRoot, '0.1.0', {
        writePointer: (path, version) => writeFile(path, JSON.stringify({ version }), 'utf8'),
        replace,
        remove: (path) => rm(path, { force: true })
      })).rejects.toThrow('rename failed')
      await expect(readFile(join(engineRoot, 'current.json'), 'utf8')).resolves.toBe(JSON.stringify({ version: '0.0.9' }))
      expect((await readdir(engineRoot)).filter((name) => name.startsWith('current.') && name.endsWith('.tmp'))).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not activate an engine that fails its health check', async () => {
    const deps = dependencies({ healthCheck: vi.fn().mockRejectedValue(new Error('bad engine')) })
    const manager = new ScraplingEngineManager('C:\\Data\\components', {
      manifest, archivePath: 'C:\\Program Files\\ContentRadar\\scrapling.zip'
    }, deps)

    await expect(manager.ensureInstalled()).rejects.toThrow('bad engine')
    expect(deps.activate).not.toHaveBeenCalled()
    expect(deps.remove).toHaveBeenCalled()
  })

  it('coalesces concurrent installation requests', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const deps = dependencies({ stageBundledArchive: vi.fn(() => blocked) })
    const manager = new ScraplingEngineManager('C:\\Data\\components', {
      manifest, archivePath: 'C:\\Program Files\\ContentRadar\\scrapling.zip'
    }, deps)

    const first = manager.ensureInstalled()
    const second = manager.ensureInstalled()
    release()
    await Promise.all([first, second])
    expect(deps.stageBundledArchive).toHaveBeenCalledTimes(1)
  })
})
