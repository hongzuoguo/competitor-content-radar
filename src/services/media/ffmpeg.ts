import ffmpegPath from 'ffmpeg-static'
import { spawn } from 'node:child_process'

export function buildWavArguments(inputPath: string, outputPath: string): string[] {
  return [
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    outputPath
  ]
}

export function extractWav(inputPath: string, outputPath: string): Promise<void> {
  if (typeof ffmpegPath !== 'string') return Promise.reject(new Error('FFMPEG_BINARY_MISSING'))
  const binaryPath = ffmpegPath

  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, buildWavArguments(inputPath, outputPath), { windowsHide: true })
    let errorOutput = ''
    child.stdout.resume()
    child.stderr.on('data', (chunk: Buffer) => {
      if (errorOutput.length < 4_000) errorOutput += chunk.toString()
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFMPEG_FAILED:${code}:${errorOutput.slice(-1_000)}`))
    })
  })
}
