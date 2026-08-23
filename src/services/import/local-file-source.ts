import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, link, mkdir, rm, stat, statfs } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { ImportError } from './import-errors'

const SUPPORTED_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm'])
const DISK_RESERVE_BYTES = 100n * 1024n * 1024n

export interface ImportedMedia {
  sourceType: 'local_file' | 'douyin_url'
  sourceKey: string
  title: string
  mediaPath: string
  originalUrl: string | null
}

interface StatFsResult {
  bavail: number | bigint
  bsize: number | bigint
}

export interface LocalFileDependencies {
  statfs(path: string): Promise<StatFsResult>
  copyFile(source: string, destination: string): Promise<void>
  link(existingPath: string, newPath: string): Promise<void>
  mkdir(path: string): Promise<void>
  rm(path: string): Promise<void>
}

const defaultDependencies: LocalFileDependencies = {
  statfs: async (path) => statfs(path, { bigint: true }),
  copyFile: async (source, destination) => copyFile(source, destination),
  link: async (existingPath, newPath) => link(existingPath, newPath),
  mkdir: async (path) => mkdir(path, { recursive: true }).then(() => undefined),
  rm: async (path) => rm(path, { force: true })
}

export async function ingestLocalFile(
  sourcePath: string,
  mediaRoot: string,
  optionalDependencies: Partial<LocalFileDependencies> = {}
): Promise<ImportedMedia> {
  const dependencies = { ...defaultDependencies, ...optionalDependencies }
  const sourceStat = await statRegularFile(sourcePath)
  const extension = extname(sourcePath).toLowerCase()
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new ImportError('UNSUPPORTED_VIDEO_FORMAT', '不支持该视频格式，请选择 MP4、MOV、MKV 或 WebM 文件。', {
      action: '选择受支持的视频文件'
    })
  }

  let digest: string
  try {
    digest = await sha256(sourcePath)
  } catch (cause) {
    throw new ImportError('FILE_NOT_FOUND', '无法读取所选视频文件，请确认文件仍然存在。', {
      action: '重新选择视频文件',
      retryable: true,
      cause
    })
  }

  const destinationDirectory = join(mediaRoot, digest)
  const mediaPath = join(destinationDirectory, `video${extension}`)
  const result: ImportedMedia = {
    sourceType: 'local_file',
    sourceKey: `sha256:${digest}`,
    title: basename(sourcePath),
    mediaPath,
    originalUrl: null
  }

  if (await isExistingFile(mediaPath)) {
    if (await isValidPublishedFile(mediaPath, sourceStat.size, digest)) return result
    throw new ImportError('MEDIA_COPY_FAILED', '已存储的视频文件不完整，请检查存储空间。', {
      action: '检查媒体存储后重试',
      retryable: true
    })
  }

  let filesystem: StatFsResult
  try {
    await dependencies.mkdir(destinationDirectory)
    filesystem = await dependencies.statfs(mediaRoot)
  } catch (cause) {
    throw mediaCopyError(cause)
  }
  const availableBytes = BigInt(filesystem.bavail) * BigInt(filesystem.bsize)
  if (availableBytes <= BigInt(sourceStat.size) + DISK_RESERVE_BYTES) {
    throw new ImportError('INSUFFICIENT_DISK_SPACE', '磁盘可用空间不足，请清理空间后重试。', {
      action: '至少保留视频大小外加 100 MiB 可用空间',
      retryable: true
    })
  }

  const temporaryPath = join(destinationDirectory, `.tmp-${randomUUID()}`)
  let operationError: unknown
  try {
    await dependencies.copyFile(sourcePath, temporaryPath)
    const copiedStat = await stat(temporaryPath)
    if (!copiedStat.isFile() || copiedStat.size !== sourceStat.size || (await sha256(temporaryPath)) !== digest) {
      throw new Error('Copied file does not match the initially hashed source')
    }

    try {
      await dependencies.link(temporaryPath, mediaPath)
    } catch (cause) {
      if (!isAlreadyExistsError(cause) || !(await isValidPublishedFile(mediaPath, sourceStat.size, digest))) throw cause
    }
  } catch (cause) {
    operationError = cause
  }

  const cleanupError = await removeTemporaryFile(temporaryPath, dependencies.rm)
  if (operationError || cleanupError) {
    const cause =
      operationError && cleanupError
        ? new AggregateError([operationError, cleanupError], 'Media copy and temporary cleanup failed')
        : operationError ?? cleanupError
    throw mediaCopyError(cause)
  }
  return result
}

async function statRegularFile(sourcePath: string) {
  try {
    const sourceStat = await stat(sourcePath)
    if (sourceStat.isFile()) return sourceStat
  } catch (cause) {
    throw new ImportError('FILE_NOT_FOUND', '无法读取所选视频文件，请确认文件仍然存在。', {
      action: '重新选择视频文件',
      retryable: true,
      cause
    })
  }
  throw new ImportError('FILE_NOT_FOUND', '所选路径不是有效的视频文件，请重新选择。', {
    action: '选择一个视频文件'
  })
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function isExistingFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function isValidPublishedFile(path: string, expectedSize: number, expectedDigest: string): Promise<boolean> {
  try {
    const publishedStat = await stat(path)
    return publishedStat.isFile() && publishedStat.size === expectedSize && (await sha256(path)) === expectedDigest
  } catch {
    return false
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

async function removeTemporaryFile(path: string, remove: (path: string) => Promise<void>): Promise<unknown> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await remove(path)
      return undefined
    } catch (cause) {
      lastError = cause
    }
  }
  return lastError
}

function mediaCopyError(cause: unknown): ImportError {
  return new ImportError('MEDIA_COPY_FAILED', '视频复制失败，请重试。', {
    action: '确认磁盘和媒体存储可用后重试',
    retryable: true,
    cause
  })
}
