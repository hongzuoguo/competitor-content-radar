import { z } from 'zod'

export const SCRAPLING_ENGINE_PROTOCOL_VERSION = 1
export const SCRAPLING_ENGINE_VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

const manifestSchema = z.object({
  protocolVersion: z.literal(SCRAPLING_ENGINE_PROTOCOL_VERSION),
  version: z.string().regex(SCRAPLING_ENGINE_VERSION_PATTERN),
  platform: z.literal('win32'),
  arch: z.literal('x64'),
  archive: z.object({
    filename: z.literal('scrapling-engine-win32-x64.zip'),
    size: z.number().int().positive().max(500_000_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/)
  }).strict(),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  pythonLockSha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict()

export type ScraplingEngineManifest = z.infer<typeof manifestSchema>

export function isScraplingEngineVersion(value: string): boolean {
  return SCRAPLING_ENGINE_VERSION_PATTERN.test(value)
}

export function parseScraplingEngineManifest(value: unknown): ScraplingEngineManifest {
  const result = manifestSchema.safeParse(value)
  if (result.success) return result.data

  const protocol = z.object({ protocolVersion: z.number() }).safeParse(value)
  const code = protocol.success && protocol.data.protocolVersion !== SCRAPLING_ENGINE_PROTOCOL_VERSION
    ? 'SCRAPLING_ENGINE_PROTOCOL_UNSUPPORTED'
    : 'SCRAPLING_ENGINE_MANIFEST_INVALID'
  throw Object.assign(new Error(code), { code, retryable: false })
}
