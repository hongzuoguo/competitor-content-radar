import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface WaveObject {
  samples: Float32Array
  sampleRate: number
}

interface OfflineStream {
  acceptWaveform(wave: WaveObject): void
  setOption(key: string, value: string): void
}

interface RecognitionResult {
  text: string
}

interface OfflineRecognizerInstance {
  createStream(): OfflineStream
  decodeAsync(stream: OfflineStream): Promise<RecognitionResult>
}

interface SherpaModule {
  OfflineRecognizer: {
    createAsync(config: Record<string, unknown>): Promise<OfflineRecognizerInstance>
  }
}

export function resolveSherpaModule(moduleValue: unknown): SherpaModule {
  const topLevel = asSherpaModule(moduleValue)
  if (topLevel) return topLevel

  const defaultExport = isRecord(moduleValue) ? asSherpaModule(moduleValue.default) : null
  if (defaultExport) return defaultExport

  throw Object.assign(new Error('Invalid sherpa-onnx-node module exports'), {
    code: 'SENSEVOICE_MODULE_INVALID'
  })
}

export async function transcribeWithSenseVoice(
  wavPath: string,
  modelDirectory: string,
  threads = 2
): Promise<string> {
  const sherpa = resolveSherpaModule(await import('sherpa-onnx-node'))
  const recognizer = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: 16_000, featureDim: 80 },
    modelConfig: {
      senseVoice: {
        model: join(modelDirectory, 'model.int8.onnx'),
        language: 'auto',
        useInverseTextNormalization: 1
      },
      tokens: join(modelDirectory, 'tokens.txt'),
      numThreads: threads,
      debug: false,
      provider: 'cpu'
    }
  })
  const wave = readPcm16Wave(wavPath)
  const stream = recognizer.createStream()
  stream.acceptWaveform(wave)
  const result = await recognizer.decodeAsync(stream)
  return result.text.trim()
}

export function readPcm16Wave(path: string): WaveObject {
  const buffer = readFileSync(path)
  if (
    buffer.length < 12 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw invalidWave()
  }

  const riffEnd = buffer.readUInt32LE(4) + 8
  if (riffEnd < 12 || riffEnd > buffer.length) throw invalidWave()

  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null
  let dataOffset = -1
  let dataSize = 0

  for (let offset = 12; offset + 8 <= riffEnd;) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkOffset = offset + 8
    const chunkEnd = chunkOffset + chunkSize
    if (chunkEnd > riffEnd) throw invalidWave()

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) throw invalidWave()
      format = {
        audioFormat: buffer.readUInt16LE(chunkOffset),
        channels: buffer.readUInt16LE(chunkOffset + 2),
        sampleRate: buffer.readUInt32LE(chunkOffset + 4),
        bitsPerSample: buffer.readUInt16LE(chunkOffset + 14)
      }
    } else if (chunkId === 'data' && dataOffset === -1) {
      dataOffset = chunkOffset
      dataSize = chunkSize
    }

    offset = chunkEnd + (chunkSize & 1)
    if (offset > riffEnd) throw invalidWave()
  }

  if (
    !format ||
    format.audioFormat !== 1 ||
    format.channels !== 1 ||
    format.sampleRate <= 0 ||
    format.bitsPerSample !== 16 ||
    dataOffset < 0 ||
    dataSize === 0 ||
    dataSize % 2 !== 0
  ) {
    throw invalidWave()
  }

  const samples = new Float32Array(dataSize / 2)
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = buffer.readInt16LE(dataOffset + index * 2) / 32_768
  }
  return { samples, sampleRate: format.sampleRate }
}

function invalidWave(): Error {
  return Object.assign(new Error('Invalid PCM16 WAV file'), {
    code: 'SENSEVOICE_WAV_INVALID'
  })
}

function asSherpaModule(value: unknown): SherpaModule | null {
  if (!isRecord(value)) return null
  const recognizer = value.OfflineRecognizer
  if ((typeof recognizer !== 'object' || recognizer === null) && typeof recognizer !== 'function') {
    return null
  }
  if (typeof (recognizer as { createAsync?: unknown }).createAsync !== 'function') {
    return null
  }
  return value as unknown as SherpaModule
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
