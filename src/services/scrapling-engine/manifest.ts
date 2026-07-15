import { z } from 'zod'

export const SCRAPLING_ENGINE_PROTOCOL_VERSION = 1
export const SCRAPLING_ENGINE_MANIFEST_URL =
  'https://github.com/hongzuoguo/competitor-content-radar/releases/download/scrapling-engine-v1/scrapling-engine-manifest.json'

const manifestSchema = z.object({
  protocolVersion: z.literal(SCRAPLING_ENGINE_PROTOCOL_VERSION),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  platform: z.literal('win32'),
  arch: z.literal('x64'),
  url: z.string().url().refine(isAllowedReleaseUrl),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive().max(500_000_000)
}).strict()

export type ScraplingEngineManifest = z.infer<typeof manifestSchema>

export function parseScraplingEngineManifest(value: unknown): ScraplingEngineManifest {
  const result = manifestSchema.safeParse(value)
  if (result.success) return result.data

  const protocol = z.object({ protocolVersion: z.number() }).safeParse(value)
  const code = protocol.success && protocol.data.protocolVersion !== SCRAPLING_ENGINE_PROTOCOL_VERSION
    ? 'SCRAPLING_ENGINE_PROTOCOL_UNSUPPORTED'
    : 'SCRAPLING_ENGINE_MANIFEST_INVALID'
  throw Object.assign(new Error(code), { code, retryable: false })
}

function isAllowedReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname.startsWith('/hongzuoguo/competitor-content-radar/releases/download/')
      && url.pathname.endsWith('.zip')
  } catch {
    return false
  }
}
