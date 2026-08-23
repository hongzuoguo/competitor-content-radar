import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function prepareModelResource({
  rootDirectory,
  manifest: suppliedManifest,
  fetch: fetchFn = globalThis.fetch,
  retryDelays = [1_000, 3_000, 7_000, 15_000],
  wait = delay
} = {}) {
  const root = rootDirectory ?? fileURLToPath(new URL('../', import.meta.url))
  const manifest = suppliedManifest ?? JSON.parse(await readFile(join(root, 'resources', 'model-manifest.json'), 'utf8'))
  const destination = join(root, '.build-resources', 'models', manifest.id)
  const fileEntries = Object.entries(manifest.files)

  await mkdir(destination, { recursive: true })
  for (const [fileName, file] of fileEntries) {
    const target = join(destination, fileName)
    await rm(`${target}.part`, { force: true })
    if (await isValidFile(target, file)) continue
    await rm(target, { force: true })
    await downloadFile(destination, fileName, file, fetchFn, retryDelays, wait)
  }

  console.log(`Prepared ${manifest.displayName}: ${manifest.id}`)
  return { source: 'manifest-download', id: manifest.id, files: Object.keys(manifest.files) }
}

async function isValidFile(path, expected) {
  try {
    await verifyFile(path, expected)
    return true
  } catch {
    return false
  }
}

async function verifyFile(filePath, expected) {
  const info = await stat(filePath)
  if (!info.isFile() || info.size !== expected.size) {
    throw new Error(`MODEL_SIZE_MISMATCH:${filePath}`)
  }

  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  if (hash.digest('hex') !== expected.sha256) {
    throw new Error(`MODEL_HASH_MISMATCH:${filePath}`)
  }
}

async function downloadFile(destination, fileName, file, fetchFn, retryDelays, wait) {
  const target = join(destination, fileName)
  const partial = `${target}.part`
  try {
    let downloaded = false
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      await rm(partial, { force: true })
      try {
        const response = await fetchFn(file.url, { redirect: 'follow' })
        if (!response.ok || !response.body) {
          const error = new Error(`MODEL_DOWNLOAD_FAILED_${response.status}`)
          if (response.status !== 408 && response.status !== 429 && response.status < 500) throw error
          throw Object.assign(error, { retryable: true })
        }
        await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
        downloaded = true
        break
      } catch (error) {
        await rm(partial, { force: true })
        if (error?.retryable !== true && !(error instanceof TypeError)) throw error
        if (attempt === retryDelays.length) throw error
        await wait(retryDelays[attempt])
      }
    }
    if (!downloaded) throw new Error('MODEL_DOWNLOAD_FAILED')
    await verifyFile(partial, file)
    await rename(partial, target)
  } finally {
    await rm(partial, { force: true })
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await prepareModelResource()
}
