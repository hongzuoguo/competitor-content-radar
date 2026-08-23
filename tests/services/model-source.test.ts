import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const modelHooks = vi.hoisted(() => ({
  afterVerification: undefined as undefined | ((path: string) => void)
}))

vi.mock('../../src/services/asr/model-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/asr/model-manager')>()
  return {
    ...actual,
    verifyModelFile: async (...args: Parameters<typeof actual.verifyModelFile>) => {
      const valid = await actual.verifyModelFile(...args)
      modelHooks.afterVerification?.(args[1])
      return valid
    }
  }
})

import { ModelSourceResolver, type ModelManifest } from '../../src/services/asr/model-source'
import type { ModelManager } from '../../src/services/asr/model-manager'

const model = Buffer.from('tiny-model')
const tokens = Buffer.from('a\nb\n')
const manifest: ModelManifest = {
  id: 'tiny-sensevoice',
  files: {
    'model.int8.onnx': fileManifest(model),
    'tokens.txt': fileManifest(tokens)
  }
}
const contents: Record<string, Buffer> = {
  'model.int8.onnx': model,
  'tokens.txt': tokens
}

const directories: string[] = []

afterEach(() => {
  modelHooks.afterVerification = undefined
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('SenseVoice model source resolver', () => {
  it('uses an initialized bundled model without downloading', async () => {
    const { bundledDirectory, cacheDirectory } = createDirectories()
    writeModel(bundledDirectory)
    const manager = createManager()
    const probe = vi.fn(async () => undefined)
    const resolver = createResolver({ bundledDirectory, cacheDirectory, manager, probe })

    await expect(resolver.resolve()).resolves.toBe(bundledDirectory)

    expect(manager.ensureFile).not.toHaveBeenCalled()
    expect(probe).toHaveBeenCalledWith(bundledDirectory)
  })

  it('uses a valid cache when the bundled model cannot initialize', async () => {
    const { bundledDirectory, cacheDirectory } = createDirectories()
    writeModel(bundledDirectory)
    writeModel(cacheDirectory)
    const manager = createManager()
    const probe = vi.fn().mockRejectedValueOnce(new Error('BUNDLED_INIT_FAILED')).mockResolvedValueOnce(undefined)
    const resolver = createResolver({ bundledDirectory, cacheDirectory, manager, probe })

    await expect(resolver.resolve()).resolves.toBe(cacheDirectory)

    expect(manager.ensureFile).not.toHaveBeenCalled()
    expect(probe).toHaveBeenNthCalledWith(1, bundledDirectory)
    expect(probe).toHaveBeenNthCalledWith(2, cacheDirectory)
  })

  it('downloads every manifest file to cache when neither candidate is usable', async () => {
    const { bundledDirectory, cacheDirectory } = createDirectories()
    const manager = createManager()
    const probe = vi.fn(async () => undefined)
    const resolver = createResolver({ bundledDirectory, cacheDirectory, manager, probe })

    await expect(resolver.resolve()).resolves.toBe(cacheDirectory)

    expect(manager.ensureFile).toHaveBeenCalledTimes(2)
    expect(manager.ensureFile).toHaveBeenCalledWith(manifest.files['model.int8.onnx'], join(cacheDirectory, 'model.int8.onnx'))
    expect(manager.ensureFile).toHaveBeenCalledWith(manifest.files['tokens.txt'], join(cacheDirectory, 'tokens.txt'))
    expect(probe).toHaveBeenCalledWith(cacheDirectory)
  })

  it('deletes a cache only when it is an exact verified duplicate after bundled initialization', async () => {
    const { bundledDirectory, cacheDirectory } = createDirectories()
    writeModel(bundledDirectory)
    writeModel(cacheDirectory)
    const resolver = createResolver({
      bundledDirectory,
      cacheDirectory,
      manager: createManager(),
      probe: async () => undefined
    })

    await resolver.resolve()

    expect(existsSync(cacheDirectory)).toBe(false)
  })

  it('does not delete the returned bundled directory when cache names the same directory differently', async () => {
    const { cacheDirectory } = createDirectories()
    const bundledDirectory = `${cacheDirectory}${sep}`
    writeModel(cacheDirectory)
    const resolver = createResolver({
      bundledDirectory,
      cacheDirectory,
      manager: createManager(),
      probe: async () => undefined
    })

    await expect(resolver.resolve()).resolves.toBe(bundledDirectory)

    expect(existsSync(cacheDirectory)).toBe(true)
  })

  it('preserves a cache directory containing an unknown file', async () => {
    const { bundledDirectory, cacheDirectory } = createDirectories()
    writeModel(bundledDirectory)
    writeModel(cacheDirectory)
    const unknown = join(cacheDirectory, 'keep.me')
    writeFileSync(unknown, 'user-data')
    const resolver = createResolver({
      bundledDirectory,
      cacheDirectory,
      manager: createManager(),
      probe: async () => undefined
    })

    await resolver.resolve()

    expect(existsSync(cacheDirectory)).toBe(true)
    expect(existsSync(unknown)).toBe(true)
  })

  it('does not recursively delete an unknown file added during cleanup', async () => {
    const { bundledDirectory, cacheDirectory } = createDirectories()
    writeModel(bundledDirectory)
    writeModel(cacheDirectory)
    const unknown = join(cacheDirectory, 'arrived-during-cleanup.txt')
    modelHooks.afterVerification = (path) => {
      if (path === join(cacheDirectory, 'model.int8.onnx')) {
        writeFileSync(unknown, 'keep')
        modelHooks.afterVerification = undefined
      }
    }
    const resolver = createResolver({
      bundledDirectory,
      cacheDirectory,
      manager: createManager(),
      probe: async () => undefined
    })

    await resolver.resolve()

    expect(existsSync(unknown)).toBe(true)
  })

  it('shares concurrent resolution and allows a retry after failure', async () => {
    const { cacheDirectory } = createDirectories()
    let releaseProbe: (() => void) | undefined
    const probe = vi.fn(() => new Promise<void>((resolve) => { releaseProbe = resolve }))
    const resolver = createResolver({
      cacheDirectory,
      manager: createManager(),
      probe
    })

    const first = resolver.resolve()
    const second = resolver.resolve()
    expect(first).toBe(second)
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1))
    releaseProbe?.()
    await expect(first).resolves.toBe(cacheDirectory)
    expect(resolver.resolve()).toBe(first)

    const retryDirectories = createDirectories()
    const manager = createManager()
    manager.ensureFile.mockRejectedValueOnce(new Error('DOWNLOAD_FAILED'))
    const retryResolver = createResolver({
      cacheDirectory: retryDirectories.cacheDirectory,
      manager,
      probe: async () => undefined
    })

    await expect(retryResolver.resolve()).rejects.toMatchObject({
      code: 'LOCAL_ASR_MODEL_UNAVAILABLE',
      message: '本地语音模型暂时不可用，请检查网络后重试或重新安装应用'
    })
    await expect(retryResolver.resolve()).resolves.toBe(retryDirectories.cacheDirectory)
    expect(manager.ensureFile).toHaveBeenCalledTimes(3)
  })
})

function createDirectories(): { bundledDirectory: string; cacheDirectory: string } {
  const root = mkdtempSync(join(tmpdir(), 'radar-model-source-'))
  directories.push(root)
  return { bundledDirectory: join(root, 'bundled'), cacheDirectory: join(root, 'cache') }
}

function createManager(): { ensureFile: ReturnType<typeof vi.fn> } {
  return {
    ensureFile: vi.fn(async (_file, destination: string) => {
      const name = destination.slice(destination.lastIndexOf('\\') + 1).split('/').pop()!
      mkdirSync(destination.slice(0, Math.max(destination.lastIndexOf('/'), destination.lastIndexOf('\\'))), { recursive: true })
      writeFileSync(destination, contents[name])
    })
  }
}

function createResolver(options: {
  bundledDirectory?: string
  cacheDirectory: string
  manager: { ensureFile: ReturnType<typeof vi.fn> }
  probe: (directory: string) => Promise<void>
}): ModelSourceResolver {
  return new ModelSourceResolver({
    manifest,
    bundledDirectory: options.bundledDirectory,
    cacheDirectory: options.cacheDirectory,
    manager: options.manager as unknown as ModelManager,
    probe: options.probe
  })
}

function writeModel(directory: string): void {
  mkdirSync(directory, { recursive: true })
  for (const [name, content] of Object.entries(contents)) writeFileSync(join(directory, name), content)
}

function fileManifest(content: Buffer) {
  return {
    url: `https://example.test/${content.toString('hex')}`,
    size: content.length,
    sha256: createHash('sha256').update(content).digest('hex')
  }
}
