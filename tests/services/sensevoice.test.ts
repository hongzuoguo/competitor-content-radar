import { describe, expect, it, vi } from 'vitest'
import { resolveSherpaModule } from '../../src/services/asr/sensevoice'

describe('SenseVoice sherpa module resolution', () => {
  it('uses top-level named exports', () => {
    const createAsync = vi.fn()
    const readWave = vi.fn()

    const resolved = resolveSherpaModule({
      OfflineRecognizer: { createAsync },
      readWave
    })

    expect(resolved.OfflineRecognizer.createAsync).toBe(createAsync)
    expect(resolved.readWave).toBe(readWave)
  })

  it('uses exports wrapped by default', () => {
    const createAsync = vi.fn()
    const readWave = vi.fn()

    const resolved = resolveSherpaModule({
      default: {
        OfflineRecognizer: { createAsync },
        readWave
      }
    })

    expect(resolved.OfflineRecognizer.createAsync).toBe(createAsync)
    expect(resolved.readWave).toBe(readWave)
  })

  it.each([
    { OfflineRecognizer: { createAsync: 'not a function' }, readWave: vi.fn() },
    { OfflineRecognizer: { createAsync: vi.fn() }, readWave: undefined }
  ])('rejects an invalid module shape', (moduleValue) => {
    expect(() => resolveSherpaModule(moduleValue)).toThrow(
      expect.objectContaining({ code: 'SENSEVOICE_MODULE_INVALID' })
    )
  })
})
