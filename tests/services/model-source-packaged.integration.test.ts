import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelSourceResolver, type ModelManifest } from '../../src/services/asr/model-source'
import type { ModelManager } from '../../src/services/asr/model-manager'
import { probeSenseVoiceModel } from '../../src/services/asr/sensevoice'

const modelId = 'sensevoice-small-int8-2024-07-17'
const bundledDirectory = resolve('release', 'win-unpacked', 'resources', 'models', modelId)
const manifestPath = resolve('resources', 'model-manifest.json')
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('packaged SenseVoice model source', () => {
  it('initializes the bundled model without attempting a download', async () => {
    const manifest = readBundledManifest()
    assertBundledModelIsPrepared(manifest)
    const cacheDirectory = mkdtempSync(join(tmpdir(), 'radar-packaged-model-cache-'))
    temporaryDirectories.push(cacheDirectory)
    const manager = {
      ensureFile: vi.fn(async () => {
        throw new Error('DOWNLOAD_ATTEMPTED_DURING_PACKAGED_MODEL_TEST')
      })
    }
    const resolver = new ModelSourceResolver({
      manifest,
      bundledDirectory,
      cacheDirectory,
      manager: manager as unknown as ModelManager,
      probe: probeSenseVoiceModel
    })

    await expect(resolver.resolve()).resolves.toBe(bundledDirectory)

    expect(manager.ensureFile).not.toHaveBeenCalled()
  }, 20_000)
})

function readBundledManifest(): ModelManifest {
  if (!existsSync(manifestPath)) {
    throw new Error(`Model manifest is missing at ${manifestPath}. Run npm run dist:dir before running this test.`)
  }

  return JSON.parse(readFileSync(manifestPath, 'utf8')) as ModelManifest
}

function assertBundledModelIsPrepared(manifest: ModelManifest): void {
  if (manifest.id !== modelId) {
    throw new Error(`Expected bundled SenseVoice manifest ${modelId}, received ${manifest.id}. Run npm run dist:dir before running this test.`)
  }

  const missing = [bundledDirectory, ...Object.keys(manifest.files).map((name) => join(bundledDirectory, name))]
    .filter((path) => !existsSync(path))
  if (missing.length > 0) {
    throw new Error(`Bundled SenseVoice model is missing: ${missing.join(', ')}. Run npm run dist:dir before running this test.`)
  }
}
