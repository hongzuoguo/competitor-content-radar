import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

const SMOKE_DENY_HOSTS_FILE_PREFIX = '--hitmuse-smoke-deny-hosts-file='
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const MAX_POLICY_BYTES = 8 * 1024

export const CANONICAL_SMOKE_DENY_HOSTS = [
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'cas-bridge.xethub.hf.co',
  'api.hitmuse.com',
  'hitmuse-beta-d8gbn7x2o2d6b8c2c-1463630014.ap-shanghai.app.tcloudbase.com'
] as const

type WebRequestListener = (details: { url: string }, callback: (response: { cancel: boolean }) => void) => void

type SmokeNetworkSession = {
  webRequest: {
    onBeforeRequest(listener: WebRequestListener): void
  }
}

type SmokeNetworkLogger = {
  info(event: { ruleId: 'SMOKE_NETWORK_DENIED', hostname: string }): void
}

function fail(): never {
  throw new Error('HITMUSE_SMOKE_NETWORK_POLICY_INVALID')
}

function hasExactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase()
}

function readDeniedHosts(path: string): Set<string> {
  if (!isAbsolute(path)) fail()
  const file = resolve(path)
  try {
    const metadata = lstatSync(file)
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_POLICY_BYTES || !samePath(realpathSync.native(file), file)) fail()
  } catch {
    fail()
  }
  let policy: unknown
  try {
    const contents = readFileSync(file)
    if (contents.byteLength > MAX_POLICY_BYTES) fail()
    policy = JSON.parse(contents.toString('utf8'))
  } catch {
    fail()
  }
  if (!hasExactKeys(policy, ['schemaVersion', 'hosts']) || policy.schemaVersion !== 1 || !Array.isArray(policy.hosts) || policy.hosts.length !== CANONICAL_SMOKE_DENY_HOSTS.length) fail()
  const hosts = new Set(policy.hosts)
  if (hosts.size !== CANONICAL_SMOKE_DENY_HOSTS.length || [...hosts].some((host) => typeof host !== 'string' || !HOSTNAME.test(host)) || policy.hosts.some((host, index) => host !== CANONICAL_SMOKE_DENY_HOSTS[index])) fail()
  return hosts
}

export function installSmokeNetworkPolicy(argv: readonly string[], session: SmokeNetworkSession, logger: SmokeNetworkLogger): boolean {
  const matches = argv.filter((argument) => argument.startsWith(SMOKE_DENY_HOSTS_FILE_PREFIX))
  if (matches.length === 0) return false
  if (matches.length !== 1) fail()
  const hosts = readDeniedHosts(matches[0].slice(SMOKE_DENY_HOSTS_FILE_PREFIX.length))
  session.webRequest.onBeforeRequest((details, callback) => {
    const hostname = new URL(details.url).hostname
    if (!hosts.has(hostname)) {
      callback({ cancel: false })
      return
    }
    logger.info({ ruleId: 'SMOKE_NETWORK_DENIED', hostname })
    callback({ cancel: true })
  })
  return true
}
