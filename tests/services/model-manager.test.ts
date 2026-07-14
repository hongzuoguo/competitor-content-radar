import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelManager } from '../../src/services/asr/model-manager'

describe('SenseVoice model manager', () => {
  const directories: string[] = []

  afterEach(() => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true })
  })

  it('resumes a partial file and verifies SHA-256 before accepting it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-model-'))
    directories.push(directory)
    const destination = join(directory, 'model.bin')
    const expected = Buffer.from('complete-model')
    writeFileSync(`${destination}.part`, expected.subarray(0, 8))
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Range')).toBe('bytes=8-')
      return new Response(expected.subarray(8), { status: 206 })
    })
    const manager = new ModelManager(fetcher as typeof fetch)

    await manager.ensureFile(
      {
        url: 'https://example.test/model.bin',
        size: expected.length,
        sha256: createHash('sha256').update(expected).digest('hex')
      },
      destination
    )

    expect(readFileSync(destination)).toEqual(expected)
  })

  it('promotes a complete valid partial file without fetching it again', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-model-'))
    directories.push(directory)
    const destination = join(directory, 'tokens.txt')
    const expected = Buffer.from('a\nb\n')
    writeFileSync(`${destination}.part`, expected)
    const fetcher = vi.fn<typeof fetch>()
    const manager = new ModelManager(fetcher)

    await manager.ensureFile(
      {
        url: 'https://example.test/tokens.txt',
        size: expected.length,
        sha256: createHash('sha256').update(expected).digest('hex')
      },
      destination
    )

    expect(fetcher).not.toHaveBeenCalled()
    expect(readFileSync(destination)).toEqual(expected)
  })

  it('discards a complete invalid partial file and downloads from zero', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-model-'))
    directories.push(directory)
    const destination = join(directory, 'tokens.txt')
    const expected = Buffer.from('a\nb\n')
    writeFileSync(`${destination}.part`, Buffer.from('bad!'))
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(new Headers(init?.headers).get('Range')).toBeNull()
      return new Response(expected, { status: 200 })
    })
    const manager = new ModelManager(fetcher)

    await manager.ensureFile(
      {
        url: 'https://example.test/tokens.txt',
        size: expected.length,
        sha256: createHash('sha256').update(expected).digest('hex')
      },
      destination
    )

    expect(readFileSync(destination)).toEqual(expected)
  })

  it('rejects and removes a file with the wrong digest', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-model-'))
    directories.push(directory)
    const destination = join(directory, 'model.bin')
    const manager = new ModelManager(async () => new Response('wrong', { status: 200 }))

    await expect(
      manager.ensureFile(
        { url: 'https://example.test/model.bin', size: 5, sha256: '0'.repeat(64) },
        destination
      )
    ).rejects.toThrow('MODEL_CHECKSUM_MISMATCH')
  })

  it('retries a transport failure while downloading a small tokens file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-model-'))
    directories.push(directory)
    const destination = join(directory, 'tokens.txt')
    const expected = Buffer.from('a\nb\n')
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(expected, { status: 200 }))
    const manager = new ModelManager(fetcher)

    await manager.ensureFile(
      {
        url: 'https://example.test/tokens.txt',
        size: expected.length,
        sha256: createHash('sha256').update(expected).digest('hex')
      },
      destination
    )

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(readFileSync(destination)).toEqual(expected)
  })

  it('stops after three model transport failures', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-model-'))
    directories.push(directory)
    const destination = join(directory, 'tokens.txt')
    const failure = new TypeError('fetch failed')
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(failure)
    const manager = new ModelManager(fetcher)

    await expect(manager.ensureFile(
      { url: 'https://example.test/tokens.txt', size: 4, sha256: '0'.repeat(64) },
      destination
    )).rejects.toBe(failure)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('does not retry a model HTTP failure', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-model-'))
    directories.push(directory)
    const destination = join(directory, 'tokens.txt')
    const cancel = vi.fn().mockResolvedValue(undefined)
    const response = new Response('unavailable', { status: 503 })
    vi.spyOn(response.body!, 'cancel').mockImplementation(cancel)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response)
    const manager = new ModelManager(fetcher)

    await expect(manager.ensureFile(
      { url: 'https://example.test/tokens.txt', size: 4, sha256: '0'.repeat(64) },
      destination
    )).rejects.toThrow('MODEL_DOWNLOAD_HTTP_503')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('cancels the model response stream when reading fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-model-'))
    directories.push(directory)
    const destination = join(directory, 'tokens.txt')
    const cancel = vi.fn().mockResolvedValue(undefined)
    const body = {
      getReader: () => ({ read: vi.fn().mockRejectedValue(new Error('read failed')), cancel })
    }
    const response = { ok: true, status: 200, body } as unknown as Response
    const manager = new ModelManager(vi.fn<typeof fetch>().mockResolvedValue(response))

    await expect(manager.ensureFile(
      { url: 'https://example.test/tokens.txt', size: 4, sha256: '0'.repeat(64) },
      destination
    )).rejects.toThrow('read failed')
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
