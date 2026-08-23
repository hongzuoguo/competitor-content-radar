import { readdir, realpath, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { ModelManager, type ModelFileManifest, verifyModelFile } from './model-manager'

export interface ModelManifest {
  id: string
  files: Record<string, ModelFileManifest>
}

interface ModelSourceOptions {
  manifest: ModelManifest
  bundledDirectory?: string
  cacheDirectory: string
  manager: ModelManager
  probe(directory: string): Promise<void>
  log?(message: string, detail?: string): void
}

export class ModelSourceResolver {
  private ready: Promise<string> | null = null

  constructor(private readonly options: ModelSourceOptions) {}

  resolve(): Promise<string> {
    this.ready ??= this.resolveOnce().catch((error) => {
      this.ready = null
      throw error
    })
    return this.ready
  }

  private async resolveOnce(): Promise<string> {
    const { bundledDirectory, cacheDirectory } = this.options
    if (bundledDirectory && await this.tryDirectory(bundledDirectory)) {
      if (!await this.sameDirectory(bundledDirectory, cacheDirectory)) {
        await this.removeExactDuplicateCache().catch(() => undefined)
      }
      return bundledDirectory
    }
    if (await this.tryDirectory(cacheDirectory)) return cacheDirectory

    try {
      for (const [name, file] of Object.entries(this.options.manifest.files)) {
        await this.options.manager.ensureFile(file, join(cacheDirectory, name))
      }
      if (await this.tryDirectory(cacheDirectory)) return cacheDirectory
    } catch {
      this.options.log?.('SenseVoice model download rejected')
    }

    throw Object.assign(
      new Error('本地语音模型暂时不可用，请检查网络后重试或重新安装应用'),
      { code: 'LOCAL_ASR_MODEL_UNAVAILABLE' }
    )
  }

  private async tryDirectory(directory: string): Promise<boolean> {
    try {
      for (const [name, file] of Object.entries(this.options.manifest.files)) {
        if (!await verifyModelFile(file, join(directory, name))) return false
      }
      await this.options.probe(directory)
      return true
    } catch {
      this.options.log?.('SenseVoice model candidate rejected')
      return false
    }
  }

  private async removeExactDuplicateCache(): Promise<void> {
    const expected = Object.keys(this.options.manifest.files).sort()
    const actual = (await readdir(this.options.cacheDirectory)).sort()
    if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) return
    for (const [name, file] of Object.entries(this.options.manifest.files)) {
      if (!await verifyModelFile(file, join(this.options.cacheDirectory, name))) return
    }
    for (const name of expected) await unlink(join(this.options.cacheDirectory, name))
    // A file may have appeared between readdir and unlink (e.g. another
    // process or a finishing download). Never delete a non-empty directory:
    // files that arrived during cleanup must be preserved.
    const remaining = await readdir(this.options.cacheDirectory).catch(() => [])
    if (remaining.length === 0) await rmdir(this.options.cacheDirectory)
  }

  private async sameDirectory(first: string, second: string): Promise<boolean> {
    try {
      return (await realpath(first)) === (await realpath(second))
    } catch {
      return false
    }
  }
}
