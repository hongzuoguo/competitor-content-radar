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

export async function transcribeWithSenseVoice(
  wavPath: string,
  modelDirectory: string,
  threads = 2
): Promise<string> {
  const sherpa = (await import('sherpa-onnx-node')) as unknown as SherpaModule
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
