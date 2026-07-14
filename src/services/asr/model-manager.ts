import { createHash } from 'node:crypto'
import { createReadStream, existsSync, renameSync, rmSync, statSync } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createTransportRetryFetcher } from '../network/fetch-with-transport-retry'

export interface ModelFileManifest {
  url: string
  size: number
  sha256: string
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export class ModelManager {
  constructor(private readonly fetchImplementation: typeof fetch = fetch) {}

  async ensureFile(manifest: ModelFileManifest, destination: string): Promise<void> {
    if (
      existsSync(destination) &&
      statSync(destination).size === manifest.size &&
      (await sha256(destination)) === manifest.sha256
    ) {
      return
    }

    await mkdir(dirname(destination), { recursive: true })
    const partial = `${destination}.part`
    let offset = existsSync(partial) ? statSync(partial).size : 0
    if (existsSync(partial) && offset === manifest.size) {
      if ((await sha256(partial)) === manifest.sha256) {
        rmSync(destination, { force: true })
        renameSync(partial, destination)
        return
      }
      rmSync(partial, { force: true })
      offset = 0
    }
    if (offset > manifest.size) {
      rmSync(partial, { force: true })
      offset = 0
    }

    const response = await createTransportRetryFetcher(this.fetchImplementation)(manifest.url, {
      headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined
    })
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`MODEL_DOWNLOAD_HTTP_${response.status}`)
    }

    const append = offset > 0 && response.status === 206
    const reader = response.body.getReader()
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(partial, append ? 'a' : 'w')
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        await handle.write(value)
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined)
      throw error
    } finally {
      await handle?.close()
    }

    const valid = statSync(partial).size === manifest.size && (await sha256(partial)) === manifest.sha256
    if (!valid) {
      rmSync(partial, { force: true })
      throw new Error('MODEL_CHECKSUM_MISMATCH')
    }

    rmSync(destination, { force: true })
    renameSync(partial, destination)
  }
}
