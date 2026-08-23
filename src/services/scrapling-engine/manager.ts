import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import extractZip from 'extract-zip'
import type { EngineCommand, ScraplingEngineLocator } from './command'
import { isScraplingEngineVersion, type ScraplingEngineManifest } from './manifest'
import { ScraplingEngineRunner } from './runner'

const EXECUTABLE_NAME = 'scrapling-engine.exe'

export interface ScraplingEngineManagerDependencies {
  readActiveVersion(expectedCommand: EngineCommand): Promise<string | null>
  stageBundledArchive(source: string, destination: string): Promise<void>
  size(path: string): Promise<number>
  sha256(path: string): Promise<string>
  extract(archive: string, destination: string): Promise<void>
  healthCheck(command: EngineCommand): Promise<void>
  promote(source: string, destination: string): Promise<void>
  activate(version: string): Promise<void>
  remove(path: string): Promise<void>
}

export interface ScraplingBundledSource {
  manifest: ScraplingEngineManifest
  archivePath: string
}

export class ScraplingEngineManager implements ScraplingEngineLocator {
  private installing: Promise<EngineCommand> | null = null
  private readonly dependencies: ScraplingEngineManagerDependencies
  private readonly engineRoot: string

  constructor(
    componentRoot: string,
    private readonly bundledSource: ScraplingBundledSource | undefined,
    dependencies: Partial<ScraplingEngineManagerDependencies> = {}
  ) {
    this.engineRoot = join(componentRoot, 'scrapling')
    this.dependencies = { ...createDefaultDependencies(this.engineRoot), ...dependencies }
  }

  ensureInstalled(): Promise<EngineCommand> {
    this.installing ??= this.install().finally(() => { this.installing = null })
    return this.installing
  }

  private async install(): Promise<EngineCommand> {
    if (!this.bundledSource) throw bundleUnavailable()

    const { manifest, archivePath } = this.bundledSource
    const command = engineCommand(join(this.engineRoot, engineDirectoryName(manifest), EXECUTABLE_NAME))
    const activeVersion = await this.dependencies.readActiveVersion(command)
    if (activeVersion === manifest.version && isScraplingEngineVersion(activeVersion)) {
      return command
    }
    return this.installEmbedded(manifest, archivePath)
  }

  private async installEmbedded(manifest: ScraplingEngineManifest, sourceArchive: string): Promise<EngineCommand> {
    const command = engineCommand(join(this.engineRoot, engineDirectoryName(manifest), EXECUTABLE_NAME))
    const finalDirectory = command.cwd
    const workspace = join(this.engineRoot, `.installing-${randomUUID()}`)
    const installDirectory = join(workspace, 'engine')
    const archivePath = join(workspace, 'archive.zip')
    await mkdir(workspace, { recursive: true })
    try {
      await this.dependencies.stageBundledArchive(sourceArchive, archivePath)
      if (await this.dependencies.size(archivePath) !== manifest.archive.size) {
        throw componentError('SCRAPLING_ENGINE_SIZE_MISMATCH')
      }
      const actualHash = await this.dependencies.sha256(archivePath)
      if (actualHash !== manifest.archive.sha256) throw componentError('SCRAPLING_ENGINE_HASH_MISMATCH')
      await this.dependencies.extract(archivePath, installDirectory)
      await this.dependencies.healthCheck(engineCommand(join(installDirectory, EXECUTABLE_NAME)))
      try {
        await this.dependencies.promote(installDirectory, finalDirectory)
      } catch (error) {
        try {
          await this.dependencies.healthCheck(command)
        } catch {
          throw error
        }
      }
      await this.dependencies.activate(manifest.version)
      return command
    } finally {
      await this.dependencies.remove(workspace)
    }
  }
}

function createDefaultDependencies(engineRoot: string): ScraplingEngineManagerDependencies {
  return {
    async readActiveVersion(expectedCommand) {
      try {
        const value = JSON.parse(await readFile(join(engineRoot, 'current.json'), 'utf8')) as unknown
        const version = typeof value === 'object' && value !== null && 'version' in value
          ? String(value.version)
          : ''
        if (!isScraplingEngineVersion(version)) return null
        await access(expectedCommand.file)
        return version
      } catch {
        return null
      }
    },
    async stageBundledArchive(source, destination) {
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(source, destination)
    },
    async size(path) {
      return (await stat(path)).size
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
          if (!inside || basename(entry.fileName) === '..') throw componentError('SCRAPLING_ENGINE_ARCHIVE_UNSAFE')
        }
      })
    },
    async healthCheck(command) {
      await access(command.file)
      await new ScraplingEngineRunner().health(command)
    },
    promote: rename,
    activate: (version) => activateScraplingEnginePointer(engineRoot, version, {
      writePointer: (path, value) => writeFile(path, JSON.stringify({ version: value }), 'utf8'),
      replace: rename,
      remove: (path) => rm(path, { force: true })
    }),
    remove: (path) => rm(path, { recursive: true, force: true })
  }
}

function engineDirectoryName(manifest: ScraplingEngineManifest): string {
  return `${manifest.version}-${manifest.archive.sha256}`
}

export interface ScraplingEnginePointerDependencies {
  writePointer(path: string, version: string): Promise<void>
  replace(source: string, destination: string): Promise<void>
  remove(path: string): Promise<void>
}

export async function activateScraplingEnginePointer(
  engineRoot: string,
  version: string,
  dependencies: ScraplingEnginePointerDependencies
): Promise<void> {
  const temporary = join(engineRoot, `current.${randomUUID()}.tmp`)
  try {
    await dependencies.writePointer(temporary, version)
    await dependencies.replace(temporary, join(engineRoot, 'current.json'))
  } finally {
    await dependencies.remove(temporary)
  }
}

function engineCommand(file: string): EngineCommand {
  return { file, args: [], cwd: dirname(file) }
}

function bundleUnavailable(): Error & { code: string, retryable: boolean } {
  return Object.assign(new Error('SCRAPLING_ENGINE_BUNDLE_UNAVAILABLE'), {
    code: 'SCRAPLING_ENGINE_BUNDLE_UNAVAILABLE', retryable: false
  })
}

function componentError(code: string): Error & { code: string, retryable: boolean } {
  return Object.assign(new Error(code), { code, retryable: true })
}
