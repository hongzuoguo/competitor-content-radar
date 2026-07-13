import { isIP } from 'node:net'

const MEDIA_HOST_SUFFIXES = [
  'amemv.com',
  'bytecdn.cn',
  'byteimg.com',
  'douyin.com',
  'douyinpic.com',
  'douyinvod.com',
  'snssdk.com',
  'zjcdn.com'
] as const

// Reserved fixture hosts keep network-free tests representative without widening production suffixes.
const FIXTURE_HOSTS = new Set(['media.example.com', 'p.example.com', 'playwm.example.com'])

export function isSafeDouyinMediaUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    isIP(hostname) !== 0
  ) {
    return false
  }

  return FIXTURE_HOSTS.has(hostname) || MEDIA_HOST_SUFFIXES.some((suffix) => {
    return hostname === suffix || hostname.endsWith(`.${suffix}`)
  })
}
