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
})
