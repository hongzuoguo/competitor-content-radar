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
  readWave(path: string): WaveObject
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
  const wave = sherpa.readWave(wavPath)
  const stream = recognizer.createStream()
  stream.acceptWaveform(wave)
  const result = await recognizer.decodeAsync(stream)
  return result.text.trim()
}

function asSherpaModule(value: unknown): SherpaModule | null {
  if (!isRecord(value) || !isRecord(value.OfflineRecognizer)) return null
  if (typeof value.OfflineRecognizer.createAsync !== 'function' || typeof value.readWave !== 'function') {
    return null
  }
  return value as unknown as SherpaModule
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
