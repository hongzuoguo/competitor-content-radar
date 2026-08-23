const { join, resolve } = require('node:path')

async function main() {
  const [wavPath, modelDirectory] = process.argv.slice(2)
  if (!wavPath || !modelDirectory) {
    throw new Error('Usage: electron scripts/smoke-offline-asr.cjs <wav-path> <model-directory>')
  }

  const sherpa = require('sherpa-onnx-node')
  const startedAt = performance.now()
  const recognizer = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: 16_000, featureDim: 80 },
    modelConfig: {
      senseVoice: {
        model: join(resolve(modelDirectory), 'model.int8.onnx'),
        language: 'auto',
        useInverseTextNormalization: 1
      },
      tokens: join(resolve(modelDirectory), 'tokens.txt'),
      numThreads: 2,
      debug: false,
      provider: 'cpu'
    }
  })
  const stream = recognizer.createStream()
  stream.acceptWaveform(sherpa.readWave(resolve(wavPath), false))
  const text = (await recognizer.decodeAsync(stream)).text.trim()
  if (!text) throw new Error('OFFLINE_ASR_EMPTY_TRANSCRIPT')

  console.log(`elapsed_ms=${Math.round(performance.now() - startedAt)} transcript_length=${text.length}`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
