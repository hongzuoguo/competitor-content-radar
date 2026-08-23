import ffmpegPath from 'ffmpeg-static'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

type PathExists = (path: string) => boolean

export function resolveFfmpegBinaryPath(
  configuredPath: string | null,
  exists: PathExists = existsSync
): string {
  const unpackedPath = configuredPath?.replace(
    /(^|[\\/])app\.asar(?=[\\/])/,
    '$1app.asar.unpacked'
  )
  if (unpackedPath && unpackedPath !== configuredPath && exists(unpackedPath)) return unpackedPath
  if (typeof configuredPath === 'string' && exists(configuredPath)) return configuredPath

  const cause = Object.assign(new Error('Configured ffmpeg binary was not found.'), {
    configuredPath,
    unpackedPath: unpackedPath === configuredPath ? undefined : unpackedPath
  })
  throw Object.assign(new Error('FFMPEG_BINARY_MISSING', { cause }), {
    code: 'FFMPEG_BINARY_MISSING'
  })
}

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

export async function extractWav(inputPath: string, outputPath: string): Promise<void> {
  const binaryPath = resolveFfmpegBinaryPath(ffmpegPath)

  await new Promise<void>((resolve, reject) => {
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
