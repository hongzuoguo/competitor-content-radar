import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeManagedWorkDirectory } from '../../src/services/media/remove-work-directory'

describe('removeManagedWorkDirectory', () => {
  const directories: string[] = []

  afterEach(() => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true })
  })

  it('removes only the work directory directly below managed storage', async () => {
    const root = mkdtempSync(join(tmpdir(), 'radar-delete-'))
    const outside = mkdtempSync(join(tmpdir(), 'radar-outside-'))
    directories.push(root, outside)
    mkdirSync(join(root, 'failed-work'))
    writeFileSync(join(root, 'failed-work', 'video.mp4'), 'managed')
    writeFileSync(join(outside, 'source.mp4'), 'outside')

    await removeManagedWorkDirectory(root, 'failed-work')

    expect(existsSync(join(root, 'failed-work'))).toBe(false)
    expect(readFileSync(join(outside, 'source.mp4'), 'utf8')).toBe('outside')
  })

  it('treats a missing candidate as success when the root is safe', async () => {
    const root = mkdtempSync(join(tmpdir(), 'radar-delete-'))
    directories.push(root)
    await expect(removeManagedWorkDirectory(root, 'missing-work')).resolves.toBeUndefined()
  })

  it.each(['..', '../outside', 'child/name', 'child\\name', 'C:\\outside', '/outside', '', '.'])
  ('rejects unsafe work id %j', async (workId) => {
    const root = mkdtempSync(join(tmpdir(), 'radar-delete-'))
    directories.push(root)
    await expect(removeManagedWorkDirectory(root, workId)).rejects.toMatchObject({ code: 'INVALID_FAILED_WORK_ID' })
  })

  it('fails closed when managed root is missing', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'radar-delete-'))
    directories.push(parent)
    await expect(removeManagedWorkDirectory(join(parent, 'missing'), 'failed-work'))
      .rejects.toMatchObject({ code: 'UNSAFE_MANAGED_WORK_PATH' })
  })

  it('fails closed for a symlinked managed root', async ({ skip }) => {
    const parent = mkdtempSync(join(tmpdir(), 'radar-delete-'))
    const outside = mkdtempSync(join(tmpdir(), 'radar-outside-'))
    const root = join(parent, 'managed')
    directories.push(parent, outside)
    mkdirSync(join(outside, 'failed-work'))
    writeFileSync(join(outside, 'failed-work', 'keep.txt'), 'keep')
    try {
      symlinkSync(outside, root, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error.code === 'EPERM' || error.code === 'EACCES')) skip()
      throw error
    }

    await expect(removeManagedWorkDirectory(root, 'failed-work'))
      .rejects.toMatchObject({ code: 'UNSAFE_MANAGED_WORK_PATH' })
    expect(readFileSync(join(outside, 'failed-work', 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('fails closed for a symlinked candidate', async ({ skip }) => {
    const root = mkdtempSync(join(tmpdir(), 'radar-delete-'))
    const outside = mkdtempSync(join(tmpdir(), 'radar-outside-'))
    directories.push(root, outside)
    writeFileSync(join(outside, 'keep.txt'), 'keep')
    try {
      symlinkSync(outside, join(root, 'failed-work'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error.code === 'EPERM' || error.code === 'EACCES')) skip()
      throw error
    }

    await expect(removeManagedWorkDirectory(root, 'failed-work'))
      .rejects.toMatchObject({ code: 'UNSAFE_MANAGED_WORK_PATH' })
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('fails closed if the root identity changes before removal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'radar-delete-'))
    directories.push(root)
    mkdirSync(join(root, 'failed-work'))
    const { lstat, realpath, stat, rm } = await import('node:fs/promises')
    let rootChecks = 0
    await expect(removeManagedWorkDirectory(root, 'failed-work', {
      lstat: async (path) => {
        const value = await lstat(path, { bigint: true })
        if (path.toLowerCase() === root.toLowerCase() && ++rootChecks === 2) {
          return new Proxy(value, {
            get(target, property, receiver) {
              return property === 'ino' ? value.ino + 1n : Reflect.get(target, property, receiver)
            }
          })
        }
        return value
      },
      realpath,
      stat,
      rm: vi.fn(rm)
    })).rejects.toMatchObject({ code: 'UNSAFE_MANAGED_WORK_PATH' })
    expect(existsSync(join(root, 'failed-work'))).toBe(true)
  })

  it('returns a stable path-free error when removal fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'radar-delete-'))
    directories.push(root)
    mkdirSync(join(root, 'failed-work'))
    const { lstat, realpath, stat } = await import('node:fs/promises')

    const failure = removeManagedWorkDirectory(root, 'failed-work', {
      lstat,
      realpath,
      stat,
      rm: vi.fn(async () => { throw Object.assign(new Error(root), { code: 'EACCES' }) })
    })

    await expect(failure).rejects.toMatchObject({ code: 'UNSAFE_MANAGED_WORK_PATH' })
    await expect(failure).rejects.not.toThrow(root)
    expect(existsSync(join(root, 'failed-work'))).toBe(true)
  })

  it('requests bigint filesystem identities for stable Windows comparisons', async () => {
    const root = mkdtempSync(join(tmpdir(), 'radar-delete-'))
    directories.push(root)
    mkdirSync(join(root, 'failed-work'))
    const { lstat, realpath, stat, rm } = await import('node:fs/promises')
    const lstatSpy = vi.fn(async (path: string, _options?: { bigint: true }) =>
      await lstat(path, { bigint: true }) as never)
    const statSpy = vi.fn(async (path: string, _options?: { bigint: true }) =>
      await stat(path, { bigint: true }) as never)

    await removeManagedWorkDirectory(root, 'failed-work', {
      lstat: lstatSpy,
      realpath,
      stat: statSpy,
      rm
    })

    expect(lstatSpy).toHaveBeenCalledWith(expect.any(String), { bigint: true })
    expect(statSpy).toHaveBeenCalledWith(expect.any(String), { bigint: true })
  })
})
