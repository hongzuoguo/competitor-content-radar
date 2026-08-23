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

  it('rejects available space exactly equal to the file size plus 100 MiB reserve', async () => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const sourcePath = join(sourceRoot, 'large.mp4')
    await writeFile(sourcePath, Buffer.alloc(16))
    const copy = vi.fn(copyFile)

    await expectImportError(
      ingestLocalFile(sourcePath, mediaRoot, {
        statfs: async () => ({ bavail: 100 * 1024 * 1024 + 16, bsize: 1 }),
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

  it('rejects and cleans up when the source changes to different same-size content before copying', async () => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const sourcePath = join(sourceRoot, 'changing.mp4')
    await writeFile(sourcePath, 'before')

    await expectImportError(
      ingestLocalFile(sourcePath, mediaRoot, {
        statfs: async () => ({ bavail: 1_000_000_000n, bsize: 1n }),
        copyFile: async (source, destination) => {
          await writeFile(source, 'after!')
          await copyFile(source, destination)
        }
      }),
      'MEDIA_COPY_FAILED'
    )

    const digest = createHash('sha256').update('before').digest('hex')
    expect(await readdir(join(mediaRoot, digest))).toEqual([])
  })

  it('does not replace a valid final file published concurrently', async () => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const sourcePath = join(sourceRoot, 'racing.mp4')
    await writeFile(sourcePath, 'source')
    const publish = vi.fn(async (temporaryPath: string, mediaPath: string) => {
      await writeFile(mediaPath, 'source')
      await link(temporaryPath, mediaPath)
    })

    const imported = await ingestLocalFile(sourcePath, mediaRoot, {
      statfs: async () => ({ bavail: 1_000_000_000, bsize: 1 }),
      link: publish
    })

    expect(publish).toHaveBeenCalledOnce()
    await expect(readFile(imported.mediaPath, 'utf8')).resolves.toBe('source')
    expect(await readdir(join(mediaRoot, imported.sourceKey.slice('sha256:'.length)))).toEqual(['video.mp4'])
  })

  it('rejects a pre-existing final file with the wrong size without modifying it', async () => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const sourcePath = join(sourceRoot, 'existing.mp4')
    const contents = Buffer.from('complete-video')
    await writeFile(sourcePath, contents)
    const digest = createHash('sha256').update(contents).digest('hex')
    const destinationDirectory = join(mediaRoot, digest)
    const mediaPath = join(destinationDirectory, 'video.mp4')
    await mkdir(destinationDirectory, { recursive: true })
    await writeFile(mediaPath, 'bad')

    await expectImportError(ingestLocalFile(sourcePath, mediaRoot), 'MEDIA_COPY_FAILED')

    await expect(readFile(mediaPath, 'utf8')).resolves.toBe('bad')
    expect(await readdir(destinationDirectory)).toEqual(['video.mp4'])
  })

  it('rejects a pre-existing final file with different same-size content', async () => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const sourcePath = join(sourceRoot, 'existing.mp4')
    await writeFile(sourcePath, 'source')
    const digest = createHash('sha256').update('source').digest('hex')
    const destinationDirectory = join(mediaRoot, digest)
    const mediaPath = join(destinationDirectory, 'video.mp4')
    await mkdir(destinationDirectory, { recursive: true })
    await writeFile(mediaPath, 'rival!')

    await expectImportError(ingestLocalFile(sourcePath, mediaRoot), 'MEDIA_COPY_FAILED')
    await expect(readFile(mediaPath, 'utf8')).resolves.toBe('rival!')
  })

  it('rejects different same-size content published concurrently without modifying it', async () => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const sourcePath = join(sourceRoot, 'racing.mp4')
    await writeFile(sourcePath, 'source')
    let competingPath = ''

    await expectImportError(
      ingestLocalFile(sourcePath, mediaRoot, {
        statfs: async () => ({ bavail: 1_000_000_000n, bsize: 1n }),
        link: async (temporaryPath, mediaPath) => {
          competingPath = mediaPath
          await writeFile(mediaPath, 'rival!')
          await link(temporaryPath, mediaPath)
        }
      }),
      'MEDIA_COPY_FAILED'
    )

    await expect(readFile(competingPath, 'utf8')).resolves.toBe('rival!')
    expect(await readdir(join(mediaRoot, createHash('sha256').update('source').digest('hex')))).toEqual(['video.mp4'])
  })

  it('maps destination directory creation failures to a stable copy error', async () => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const sourcePath = join(sourceRoot, 'clip.mp4')
    await writeFile(sourcePath, 'video')
    const sensitivePath = join(mediaRoot, 'private')

    const error = await captureImportError(
      ingestLocalFile(sourcePath, mediaRoot, {
        mkdir: async () => {
          throw new Error(`denied: ${sensitivePath}`)
        }
      })
    )
    expect(error.code).toBe('MEDIA_COPY_FAILED')
    expect(error.message).not.toContain(sensitivePath)
  })

  it('maps filesystem space inspection failures to a stable copy error', async () => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const sourcePath = join(sourceRoot, 'clip.mp4')
    await writeFile(sourcePath, 'video')

    await expectImportError(
      ingestLocalFile(sourcePath, mediaRoot, {
        statfs: async () => {
          throw new Error('statfs denied')
        }
      }),
      'MEDIA_COPY_FAILED'
    )
  })

  it('retries temporary cleanup and does not report success when cleanup keeps failing', async () => {
    const { sourceRoot, mediaRoot } = await createWorkspace()
    const sourcePath = join(sourceRoot, 'clip.mp4')
    await writeFile(sourcePath, 'video')
    const remove = vi.fn(async () => {
      throw new Error('cleanup denied')
    })

    await expectImportError(
      ingestLocalFile(sourcePath, mediaRoot, {
        statfs: async () => ({ bavail: 1_000_000_000n, bsize: 1n }),
        rm: remove
      }),
      'MEDIA_COPY_FAILED'
    )
    expect(remove).toHaveBeenCalledTimes(3)
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
