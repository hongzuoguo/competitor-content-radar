import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { verifyFfmpegResource } from './verify-resource-completeness.mjs'

const scriptPath = fileURLToPath(import.meta.url)
const projectRoot = resolve(scriptPath, '..', '..')

export async function verifyReleaseDependencies({ rootDirectory = projectRoot, manifest } = {}) {
  const executable = await verifyFfmpegResource({ rootDirectory, manifest })
  return { package: 'ffmpeg-static', version: '5.3.0', executable }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyReleaseDependencies().then((result) => {
    console.log(`Verified FFmpeg release binary: ${result.executable.size} bytes, ${result.executable.sha256}`)
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : 'RELEASE_DEPENDENCY_VERIFICATION_FAILED')
    process.exitCode = 1
  })
}
