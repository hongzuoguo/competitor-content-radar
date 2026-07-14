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

function isDouyinMediaHostname(hostname: string): boolean {
  return MEDIA_HOST_SUFFIXES.some((suffix) => {
    return hostname === suffix || hostname.endsWith(`.${suffix}`)
  })
}

function isAllowedMediaHostname(hostname: string): boolean {
  return FIXTURE_HOSTS.has(hostname) || isDouyinMediaHostname(hostname)
}

function isSafeCtydohProxy(url: URL, hostname: string): boolean {
  if (hostname === 'ctydoh.cn' || !hostname.endsWith('.ctydoh.cn') || url.port !== '20002') return false

  const encodedTarget = url.pathname.split('/')[1]
  if (!encodedTarget) return false

  let target: string
  try {
    target = decodeURIComponent(encodedTarget).toLowerCase()
  } catch {
    return false
  }

  return (
    /^[a-z0-9.-]+$/.test(target) &&
    !target.startsWith('.') &&
    !target.endsWith('.') &&
    isIP(target) === 0 &&
    isDouyinMediaHostname(target)
  )
}

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
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    isIP(hostname) !== 0
  ) {
    return false
  }

  if (url.port) return isSafeCtydohProxy(url, hostname)
  return isAllowedMediaHostname(hostname)
}
