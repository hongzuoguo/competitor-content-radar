import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { prepareSmokeRuntimeReadiness } from '../../src/main/smoke-runtime-readiness'

describe('smoke runtime readiness', () => {
  it('publishes the ready marker only after the caller confirms normal startup completed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hitmuse-smoke-readiness-'))
    const userData = join(root, 'user-data')
    await mkdir(userData)
    const verify = vi.fn(async () => undefined)
    const marker = join(userData, 'runtime-readiness.json')
    try {
      const publish = await prepareSmokeRuntimeReadiness(
        ['HitMuse.exe', `--hitmuse-smoke-runtime-readiness-file=${marker}`],
        userData,
        { verify }
      )

      expect(verify).toHaveBeenCalledOnce()
      await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(publish).toBeTypeOf('function')
      await publish!()
      await expect(readFile(marker, 'utf8')).resolves.toBe('{"schemaVersion":1,"engine":"ready","model":"ready"}')
      const markerStatus = await lstat(marker)
      expect(markerStatus.isFile()).toBe(true)
      expect(markerStatus.isSymbolicLink()).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a stale readiness marker before running either embedded probe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hitmuse-smoke-readiness-'))
    const userData = join(root, 'user-data')
    const marker = join(userData, 'runtime-readiness.json')
    const verify = vi.fn(async () => undefined)
    await mkdir(userData)
    await writeFile(marker, '{"schemaVersion":1,"engine":"ready","model":"ready"}')
    try {
      await expect(prepareSmokeRuntimeReadiness(
        ['HitMuse.exe', `--hitmuse-smoke-runtime-readiness-file=${marker}`],
        userData,
        { verify }
      )).rejects.toThrow('HITMUSE_SMOKE_RUNTIME_READINESS_ALREADY_EXISTS')
      expect(verify).not.toHaveBeenCalled()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
