import { z } from 'zod'

export const ProviderTemplateSchema = z.enum(['deepseek', 'doubao', 'kimi', 'qwen', 'custom'])

const baseUrlSchema = z.string().trim().url().refine((value) => {
  try {
    const url = new URL(value)
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()

    return url.protocol === 'https:' || (
      url.protocol === 'http:' &&
      (hostname === 'localhost' || hostname === '::1' || isLoopbackIpv4(hostname))
    )
  } catch {
    return false
  }
}, 'Base URL must use HTTPS or loopback HTTP')

function isLoopbackIpv4(hostname: string): boolean {
  const octets = hostname.split('.')
  return octets.length === 4 && octets[0] === '127' && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
}

export const ModelProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  providerTemplate: ProviderTemplateSchema,
  baseUrl: baseUrlSchema,
  modelId: z.string().trim().min(1).max(160),
  requiresApiKey: z.boolean(),
  enabled: z.boolean()
})

export type ProviderTemplate = z.infer<typeof ProviderTemplateSchema>
export type ModelProfileInput = z.infer<typeof ModelProfileInputSchema>
