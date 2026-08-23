import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  probeSenseVoiceModel,
  readPcm16Wave,
  resolveSherpaModule,
  transcribeWithSenseVoice
} from '../../src/services/asr/sensevoice'

const sherpaMocks = vi.hoisted(() => ({
  createAsync: vi.fn(),
  createStream: vi.fn(),
  decodeAsync: vi.fn()
}))

vi.mock('sherpa-onnx-node', () => ({
  OfflineRecognizer: { createAsync: sherpaMocks.createAsync }
}))

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

beforeEach(() => {
  vi.clearAllMocks()
  sherpaMocks.createAsync.mockResolvedValue({
    createStream: sherpaMocks.createStream,
    decodeAsync: sherpaMocks.decodeAsync
  })
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

describe('SenseVoice transcription', () => {
  it('probes the model with the same recognizer configuration as transcription', async () => {
    await probeSenseVoiceModel('C:\\models\\sensevoice', 4)

    expect(sherpaMocks.createAsync).toHaveBeenCalledWith({
      featConfig: { sampleRate: 16_000, featureDim: 80 },
      modelConfig: {
        senseVoice: {
          model: join('C:\\models\\sensevoice', 'model.int8.onnx'),
          language: 'auto',
          useInverseTextNormalization: 1
        },
        tokens: join('C:\\models\\sensevoice', 'tokens.txt'),
        numThreads: 4,
        debug: false,
        provider: 'cpu'
      }
    })
  })

  it('decodes a long wave in five-minute segments and reports segment progress', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sensevoice-segments-'))
    directories.push(directory)
    const path = join(directory, 'audio.wav')
    writeFileSync(path, createLongWave(600))

    const accepted: Float32Array[] = []
    sherpaMocks.createStream.mockImplementation(() => ({
      acceptWaveform: (wave: { samples: Float32Array }) => accepted.push(wave.samples),
      setOption: vi.fn()
    }))
    sherpaMocks.decodeAsync
      .mockResolvedValueOnce({ text: 'first segment' })
      .mockResolvedValueOnce({ text: 'second segment' })
    const progress = vi.fn()

    const text = await transcribeWithSenseVoice(path, directory, 2, progress)

    expect(text).toBe('first segment\nsecond segment')
    expect(accepted.map((samples) => samples.length)).toEqual([4_800_000, 4_800_000])
    expect(progress).toHaveBeenNthCalledWith(1, 1, 2)
    expect(progress).toHaveBeenNthCalledWith(2, 2, 2)
  })
})

function createLongWave(durationSeconds: number): Buffer {
  const sampleRate = 16_000
  const dataSize = durationSeconds * sampleRate * 2
  const wave = Buffer.alloc(44 + dataSize)
  wave.write('RIFF', 0, 'ascii')
  wave.writeUInt32LE(wave.length - 8, 4)
  wave.write('WAVE', 8, 'ascii')
  wave.write('fmt ', 12, 'ascii')
  wave.writeUInt32LE(16, 16)
  wave.writeUInt16LE(1, 20)
  wave.writeUInt16LE(1, 22)
  wave.writeUInt32LE(sampleRate, 24)
  wave.writeUInt32LE(sampleRate * 2, 28)
  wave.writeUInt16LE(2, 32)
  wave.writeUInt16LE(16, 34)
  wave.write('data', 36, 'ascii')
  wave.writeUInt32LE(dataSize, 40)
  return wave
}
