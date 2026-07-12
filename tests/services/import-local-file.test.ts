import { createHash } from 'node:crypto'
import { copyFile, link, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImportError } from '../../src/services/import/import-errors'
import { ingestLocalFile } from '../../src/services/import/local-file-source'

describe('local video ingestion', () => {
  const temporaryDirectories: string[] = []

  async function createWorkspace(): Promise<{ sourceRoot: string; mediaRoot: string }> {
    const root = await mkdtemp(join(tmpdir(), 'radar-import-'))
    temporaryDirectories.push(root)
    const sourceRoot = join(root, 'source')
    const mediaRoot = join(root, 'media')
    await mkdir(sourceRoot)
    return { sourceRoot, mediaRoot }
  }

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  })

  it.each(['.mp4', '.MOV', '.mkv', '.WeBm'])('imports supported %s videos into content-addressed storage', async (extension) => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const sourcePath = join(sourceRoot, `示例${extension}`)
    const contents = Buffer.from(`video-${extension}`)
    await writeFile(sourcePath, contents)
    const digest = createHash('sha256').update(contents).digest('hex')

    const imported = await ingestLocalFile(sourcePath, mediaRoot, {
      statfs: async () => ({ bavail: 1_000_000_000, bsize: 1 })
    })

    expect(imported).toEqual({
      sourceType: 'local_file',
      sourceKey: `sha256:${digest}`,
      title: basename(sourcePath),
      mediaPath: join(mediaRoot, digest, `video${extension.toLowerCase()}`),
      originalUrl: null
    })
    await expect(readFile(imported.mediaPath)).resolves.toEqual(contents)
  })

  it('returns the same source key and path for files with identical content without overwriting the destination', async () => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const first = join(sourceRoot, 'first.mp4')
    const second = join(sourceRoot, 'second.MP4')
    await writeFile(first, 'same-video')
    await writeFile(second, 'same-video')

    const dependencies = { statfs: async () => ({ bavail: 1_000_000_000n, bsize: 1n }) }
    const firstImport = await ingestLocalFile(first, mediaRoot, dependencies)
    const copy = vi.fn(copyFile)
    const secondImport = await ingestLocalFile(second, mediaRoot, { ...dependencies, copyFile: copy })

    expect(secondImport.sourceKey).toBe(firstImport.sourceKey)
    expect(secondImport.mediaPath).toBe(firstImport.mediaPath)
    expect(copy).not.toHaveBeenCalled()
  })

  it('rejects unsupported extensions with a stable error', async () => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const sourcePath = join(sourceRoot, 'clip.avi')
    await writeFile(sourcePath, 'video')

    await expectImportError(ingestLocalFile(sourcePath, mediaRoot), 'UNSUPPORTED_VIDEO_FORMAT')
  })

  it('rejects a missing file without exposing its path in the user message', async () => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const sourcePath = join(sourceRoot, 'private-name.mp4')

    const error = await captureImportError(ingestLocalFile(sourcePath, mediaRoot))
    expect(error.code).toBe('FILE_NOT_FOUND')
    expect(error.message).not.toContain(sourcePath)
    expect(error.message).not.toContain('private-name.mp4')
  })

  it('rejects paths that are not regular files', async () => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const directoryPath = join(sourceRoot, 'directory.mp4')
    await mkdir(directoryPath)

    await expectImportError(ingestLocalFile(directoryPath, mediaRoot), 'FILE_NOT_FOUND')
  })

  it('checks available space including a 100 MiB reserve before copying', async () => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const sourcePath = join(sourceRoot, 'large.mp4')
    await writeFile(sourcePath, Buffer.alloc(16))
    const copy = vi.fn(copyFile)

    await expectImportError(
      ingestLocalFile(sourcePath, mediaRoot, {
        statfs: async () => ({ bavail: 100 * 1024 * 1024 + 15, bsize: 1 }),
        copyFile: copy
      }),
      'INSUFFICIENT_DISK_SPACE'
    )
    expect(copy).not.toHaveBeenCalled()
  })

  it('removes a partial temporary file and returns a stable error when copying fails', async () => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const sourcePath = join(sourceRoot, 'clip.mp4')
    await writeFile(sourcePath, 'video')

    await expectImportError(
      ingestLocalFile(sourcePath, mediaRoot, {
        statfs: async () => ({ bavail: 1_000_000_000, bsize: 1 }),
        copyFile: async (_source, destination) => {
          await writeFile(destination, 'partial')
          throw new Error('simulated sensitive copy detail')
        }
      }),
      'MEDIA_COPY_FAILED'
    )

    const digest = createHash('sha256').update('video').digest('hex')
    expect(await readdir(join(mediaRoot, digest))).toEqual([])
  })

  it('rejects and cleans up when the copied size differs from the initial source size', async () => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const sourcePath = join(sourceRoot, 'changing.mp4')
    await writeFile(sourcePath, 'original')

    await expectImportError(
      ingestLocalFile(sourcePath, mediaRoot, {
        statfs: async () => ({ bavail: 1_000_000_000, bsize: 1 }),
        copyFile: async (_source, destination) => writeFile(destination, 'short')
      }),
      'MEDIA_COPY_FAILED'
    )

    const digest = createHash('sha256').update('original').digest('hex')
    expect(await readdir(join(mediaRoot, digest))).toEqual([])
  })

  it('does not replace a valid final file published concurrently', async () => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const sourcePath = join(sourceRoot, 'racing.mp4')
    await writeFile(sourcePath, 'source')
    const publish = vi.fn(async (temporaryPath: string, mediaPath: string) => {
      await writeFile(mediaPath, 'rival!')
      await link(temporaryPath, mediaPath)
    })

    const imported = await ingestLocalFile(sourcePath, mediaRoot, {
      statfs: async () => ({ bavail: 1_000_000_000, bsize: 1 }),
      link: publish
    })

    expect(publish).toHaveBeenCalledOnce()
    await expect(readFile(imported.mediaPath, 'utf8')).resolves.toBe('rival!')
    expect(await readdir(join(mediaRoot, imported.sourceKey.slice('sha256:'.length)))).toEqual(['video.mp4'])
  })
})

async function captureImportError(promise: Promise<unknown>): Promise<ImportError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError)
    return error as ImportError
  }
  throw new Error('Expected ingestion to fail')
}

async function expectImportError(promise: Promise<unknown>, code: ImportError['code']): Promise<void> {
  const error = await captureImportError(promise)
  expect(error.code).toBe(code)
  expect(error.message).toMatch(/[\u4e00-\u9fff]/)
}
