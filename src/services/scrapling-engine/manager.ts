import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import extractZip from 'extract-zip'
import {
  SCRAPLING_ENGINE_MANIFEST_URL,
  parseScraplingEngineManifest,
  type ScraplingEngineManifest
} from './manifest'
import { ScraplingEngineRunner } from './runner'

const EXECUTABLE_NAME = 'scrapling-engine.exe'

export interface ScraplingEngineManagerDependencies {
  loadManifest(): Promise<ScraplingEngineManifest>
  readActiveVersion(): Promise<string | null>
  download(url: string, destination: string, expectedSize: number): Promise<void>
  sha256(path: string): Promise<string>
  extract(archive: string, destination: string): Promise<void>
  healthCheck(executablePath: string): Promise<void>
  promote(source: string, destination: string): Promise<void>
  activate(version: string): Promise<void>
  remove(path: string): Promise<void>
}

export class ScraplingEngineManager {
  private installing: Promise<string> | null = null
  private readonly dependencies: ScraplingEngineManagerDependencies
  private readonly engineRoot: string

  constructor(
    componentRoot: string,
    dependencies: Partial<ScraplingEngineManagerDependencies> = {}
  ) {
    this.engineRoot = join(componentRoot, 'scrapling')
    const defaults = createDefaultDependencies(this.engineRoot)
    this.dependencies = { ...defaults, ...dependencies }
  }

  ensureInstalled(): Promise<string> {
    this.installing ??= this.install().finally(() => { this.installing = null })
    return this.installing
  }

  private async install(): Promise<string> {
    const activeVersion = await this.dependencies.readActiveVersion()
    let manifest: ScraplingEngineManifest
    try {
      manifest = await this.dependencies.loadManifest()
    } catch (error) {
      if (activeVersion) return join(this.engineRoot, activeVersion, EXECUTABLE_NAME)
      throw error
    }
    const finalDirectory = join(this.engineRoot, manifest.version)
    const executablePath = join(finalDirectory, EXECUTABLE_NAME)
    if (activeVersion === manifest.version) return executablePath

    const installDirectory = `${finalDirectory}.installing-${process.pid}-${Date.now()}`
    const archivePath = join(this.engineRoot, `${manifest.version}.download`)
    await mkdir(this.engineRoot, { recursive: true })
    try {
      await this.dependencies.download(manifest.url, archivePath, manifest.size)
      const actualHash = await this.dependencies.sha256(archivePath)
      if (actualHash !== manifest.sha256) {
        throw Object.assign(new Error('SCRAPLING_ENGINE_HASH_MISMATCH'), {
          code: 'SCRAPLING_ENGINE_HASH_MISMATCH', retryable: true
        })
      }
      await this.dependencies.extract(archivePath, installDirectory)
      await this.dependencies.healthCheck(join(installDirectory, EXECUTABLE_NAME))
      await this.dependencies.remove(finalDirectory)
      await this.dependencies.promote(installDirectory, finalDirectory)
      await this.dependencies.activate(manifest.version)
      return executablePath
    } catch (error) {
      await this.dependencies.remove(installDirectory)
      throw error
    } finally {
      await this.dependencies.remove(archivePath)
    }
  }
}

function createDefaultDependencies(engineRoot: string): ScraplingEngineManagerDependencies {
  return {
    async loadManifest() {
      const manifestUrl = new URL(SCRAPLING_ENGINE_MANIFEST_URL)
      manifestUrl.searchParams.set('cache', String(Date.now()))
      const response = await fetch(manifestUrl, { redirect: 'follow', cache: 'no-store' })
      if (!response.ok || !isAllowedDownloadResponse(response.url)) {
        throw componentError('SCRAPLING_ENGINE_MANIFEST_UNAVAILABLE')
      }
      return parseScraplingEngineManifest(await response.json())
    },
    async readActiveVersion() {
      try {
        const value = JSON.parse(await readFile(join(engineRoot, 'current.json'), 'utf8')) as unknown
        const version = typeof value === 'object' && value !== null && 'version' in value
          ? String(value.version)
          : ''
        if (!/^\d+\.\d+\.\d+$/.test(version)) return null
        await access(join(engineRoot, version, EXECUTABLE_NAME))
        return version
      } catch {
        return null
      }
    },
    async download(url, destination, expectedSize) {
      const response = await fetch(url, { redirect: 'follow' })
      if (!response.ok || !isAllowedDownloadResponse(response.url)) {
        throw componentError('SCRAPLING_ENGINE_DOWNLOAD_FAILED')
      }
      const declaredSize = Number(response.headers.get('content-length'))
      if (Number.isFinite(declaredSize) && declaredSize !== expectedSize) {
        throw componentError('SCRAPLING_ENGINE_SIZE_MISMATCH')
      }
      if (!response.body) throw componentError('SCRAPLING_ENGINE_DOWNLOAD_FAILED')
      await mkdir(dirname(destination), { recursive: true })
      await pipeline(response.body, createWriteStream(destination))
      const downloadedSize = (await import('node:fs/promises')).stat(destination).then((item) => item.size)
      if (await downloadedSize !== expectedSize) throw componentError('SCRAPLING_ENGINE_SIZE_MISMATCH')
    },
    async sha256(path) {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(path)) hash.update(chunk)
      return hash.digest('hex')
    },
    async extract(archive, destination) {
      await mkdir(destination, { recursive: true })
      const root = resolve(destination)
      await extractZip(archive, {
        dir: root,
        onEntry(entry) {
          const target = resolve(root, entry.fileName)
          const inside = target === root || (!relative(root, target).startsWith(`..${sep}`) && relative(root, target) !== '..')
          if (!inside || basename(entry.fileName) === '..') {
            throw componentError('SCRAPLING_ENGINE_ARCHIVE_UNSAFE')
          }
        }
      })
    },
    async healthCheck(executablePath) {
      await access(executablePath)
      await new ScraplingEngineRunner().health(executablePath)
    },
    promote: rename,
    async activate(version) {
      const temporary = join(engineRoot, `current.${process.pid}.tmp`)
      await writeFile(temporary, JSON.stringify({ version }), 'utf8')
      await rm(join(engineRoot, 'current.json'), { force: true })
      await rename(temporary, join(engineRoot, 'current.json'))
    },
    remove: (path) => rm(path, { recursive: true, force: true })
  }
}

function isAllowedDownloadResponse(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && [
      'github.com',
      'objects.githubusercontent.com',
      'release-assets.githubusercontent.com'
    ].includes(url.hostname)
  } catch {
    return false
  }
}

function componentError(code: string): Error & { code: string; retryable: boolean } {
  return Object.assign(new Error(code), { code, retryable: true })
}
