import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPcm16Wave, resolveSherpaModule } from '../../src/services/asr/sensevoice'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function createWave(audioFormat = 1): Buffer {
  const formatChunk = Buffer.alloc(24)
  formatChunk.write('fmt ', 0, 'ascii')
  formatChunk.writeUInt32LE(16, 4)
  formatChunk.writeUInt16LE(audioFormat, 8)
  formatChunk.writeUInt16LE(1, 10)
  formatChunk.writeUInt32LE(16_000, 12)
  formatChunk.writeUInt32LE(32_000, 16)
  formatChunk.writeUInt16LE(2, 20)
  formatChunk.writeUInt16LE(16, 22)

  const extraChunk = Buffer.alloc(12)
  extraChunk.write('JUNK', 0, 'ascii')
  extraChunk.writeUInt32LE(3, 4)
  extraChunk.set([1, 2, 3], 8)

  const dataChunk = Buffer.alloc(12)
  dataChunk.write('data', 0, 'ascii')
  dataChunk.writeUInt32LE(4, 4)
  dataChunk.writeInt16LE(-32_768, 8)
  dataChunk.writeInt16LE(16_384, 10)

  const wave = Buffer.concat([Buffer.alloc(12), formatChunk, extraChunk, dataChunk])
  wave.write('RIFF', 0, 'ascii')
  wave.writeUInt32LE(wave.length - 8, 4)
  wave.write('WAVE', 8, 'ascii')
  return wave
}

describe('SenseVoice sherpa module resolution', () => {
  it('uses top-level named exports', () => {
    const createAsync = vi.fn()

    const resolved = resolveSherpaModule({
      OfflineRecognizer: { createAsync }
    })

    expect(resolved.OfflineRecognizer.createAsync).toBe(createAsync)
  })

  it('uses exports wrapped by default', () => {
    const createAsync = vi.fn()

    const resolved = resolveSherpaModule({
      default: {
        OfflineRecognizer: { createAsync }
      }
    })

    expect(resolved.OfflineRecognizer.createAsync).toBe(createAsync)
  })

  it('accepts a class-shaped recognizer without readWave wrapped by default', () => {
    const createAsync = vi.fn()
    class OfflineRecognizer {
      static createAsync = createAsync
    }

    const resolved = resolveSherpaModule({
      default: { OfflineRecognizer }
    })

    expect(resolved.OfflineRecognizer.createAsync).toBe(createAsync)
  })

  it.each([
    { OfflineRecognizer: { createAsync: 'not a function' } },
    { OfflineRecognizer: undefined }
  ])('rejects an invalid module shape', (moduleValue) => {
    expect(() => resolveSherpaModule(moduleValue)).toThrow(
      expect.objectContaining({ code: 'SENSEVOICE_MODULE_INVALID' })
    )
  })
})

describe('SenseVoice PCM16 WAV reader', () => {
  it('reads mono PCM16 data after an extra odd-sized padded chunk', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sensevoice-wave-'))
    directories.push(directory)
    const path = join(directory, 'audio.wav')
    writeFileSync(path, createWave())

    const wave = readPcm16Wave(path)

    expect(wave.sampleRate).toBe(16_000)
    expect(Array.from(wave.samples)).toEqual([-1, 0.5])
  })

  it('rejects a non-PCM WAV with a stable code', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sensevoice-wave-'))
    directories.push(directory)
    const path = join(directory, 'audio.wav')
    writeFileSync(path, createWave(3))

    expect(() => readPcm16Wave(path)).toThrow(
      expect.objectContaining({ code: 'SENSEVOICE_WAV_INVALID' })
    )
  })
})
