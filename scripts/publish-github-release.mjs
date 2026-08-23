import { createHash } from 'node:crypto'
import { lstat, open, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const MAX_ASSET_BYTES = 512 * 1024 * 1024
const MAX_TOTAL_ASSET_BYTES = 1024 * 1024 * 1024

function fail(code) {
  throw new Error(code)
}

function samePath(left, right) {
  const normalize = (value) => process.platform === 'win32' ? value.toLowerCase() : value
  return normalize(resolve(left)) === normalize(resolve(right))
}

function isStrictDescendant(parent, child) {
  const difference = relative(parent, child)
  return difference !== '' && !difference.startsWith('..') && !isAbsolute(difference)
}

function overlaps(left, right) {
  return samePath(left, right) || isStrictDescendant(left, right) || isStrictDescendant(right, left)
}

async function assertOrdinaryExistingPath(path, code) {
  const resolved = resolve(path)
  for (let current = resolved; ; current = dirname(current)) {
    const entry = await lstat(current)
    if (entry.isSymbolicLink() || !samePath(await realpath(current), current)) fail(code)
    const parent = dirname(current)
    if (parent === current) return resolved
  }
}

async function assertOrdinaryDirectory(path, code) {
  const resolved = await assertOrdinaryExistingPath(path, code)
  if (!(await lstat(resolved)).isDirectory()) fail(code)
  return resolved
}

async function readVerifiedAsset(path, expectedBytes, expectedSha256) {
  const entry = await lstat(path)
  if (!entry.isFile() || entry.isSymbolicLink() || expectedBytes > MAX_ASSET_BYTES || entry.size !== expectedBytes) fail('RELEASE_ASSET_INVALID')
  const handle = await open(path, 'r')
  try {
    const details = await handle.stat()
    if (!details.isFile() || details.size !== expectedBytes || details.size > MAX_ASSET_BYTES) fail('RELEASE_ASSET_INVALID')
    const hash = createHash('sha256')
    const bytes = Buffer.allocUnsafe(details.size)
    let position = 0
    while (position < details.size) {
      const { bytesRead } = await handle.read(bytes, position, details.size - position, position)
      if (bytesRead === 0) fail('RELEASE_ASSET_INVALID')
      hash.update(bytes.subarray(position, position + bytesRead))
      position += bytesRead
    }
    const after = await handle.stat()
    if (!after.isFile() || after.size !== details.size || position !== expectedBytes || hash.digest('hex') !== expectedSha256) fail('RELEASE_ASSET_DIGEST_MISMATCH')
    return bytes
  } finally {
    await handle.close()
  }
}

function exactKeys(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) fail(code)
}

async function readJson(path, code) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    fail(code)
  }
}

async function validateInputs(options) {
  if (!options || typeof options !== 'object') fail('RELEASE_OPTIONS_INVALID')
  const { repository, tag, commit, assetsManifest, evidenceDirectory, environment = process.env } = options
  if (typeof repository !== 'string' || typeof tag !== 'string' || typeof commit !== 'string' || typeof assetsManifest !== 'string' || typeof evidenceDirectory !== 'string' || !environment || typeof environment !== 'object') fail('RELEASE_OPTIONS_INVALID')
  if (!REPOSITORY_PATTERN.test(repository) || !COMMIT_PATTERN.test(commit) || !tag.startsWith('v') || !VERSION_PATTERN.test(tag.slice(1)) || !isAbsolute(assetsManifest) || !isAbsolute(evidenceDirectory)) fail('RELEASE_OPTIONS_INVALID')
  if (typeof environment.GITHUB_TOKEN !== 'string' || environment.GITHUB_TOKEN.trim() === '') fail('GITHUB_TOKEN_REQUIRED')
  const evidence = await assertOrdinaryDirectory(evidenceDirectory, 'RELEASE_EVIDENCE_PATH_INVALID')
  const manifest = await assertOrdinaryExistingPath(assetsManifest, 'RELEASE_ASSETS_MANIFEST_INVALID')
  if (!isStrictDescendant(evidence, manifest) || overlaps(REPOSITORY_ROOT, evidence)) fail('RELEASE_EVIDENCE_PATH_INVALID')
  if (!(await lstat(manifest)).isFile()) fail('RELEASE_ASSETS_MANIFEST_INVALID')
  const packageJson = await readJson(join(REPOSITORY_ROOT, 'package.json'), 'RELEASE_PACKAGE_INVALID')
  if (packageJson.version !== tag.slice(1)) fail('RELEASE_PACKAGE_VERSION_MISMATCH')
  return { repository, tag, commit, manifest, evidence, token: environment.GITHUB_TOKEN }
}

async function validateEvidence({ evidence, manifest, commit, tag }) {
  const [assetManifest, buildManifest, checksumsBytes, shaSumsBytes] = await Promise.all([
    readJson(manifest, 'RELEASE_ASSETS_MANIFEST_INVALID'),
    readJson(join(evidence, 'build-manifest.json'), 'RELEASE_EVIDENCE_INVALID'),
    readFile(join(evidence, 'checksums.json')).catch(() => fail('RELEASE_EVIDENCE_INVALID')),
    readFile(join(evidence, 'SHA256SUMS.txt')).catch(() => fail('RELEASE_EVIDENCE_INVALID'))
  ])
  let checksums
  try { checksums = JSON.parse(checksumsBytes.toString('utf8')) } catch { fail('RELEASE_EVIDENCE_INVALID') }
  const version = tag.slice(1)
  exactKeys(assetManifest, ['schemaVersion', 'commit', 'version', 'assets'], 'RELEASE_ASSETS_MANIFEST_INVALID')
  if (assetManifest.schemaVersion !== 1 || assetManifest.commit !== commit || assetManifest.version !== version || !Array.isArray(assetManifest.assets) || assetManifest.assets.length === 0) fail('RELEASE_ASSETS_MANIFEST_INVALID')
  exactKeys(buildManifest, ['schemaVersion', 'status', 'commit', 'version', 'artifactCount'], 'RELEASE_EVIDENCE_INVALID')
  if (buildManifest.schemaVersion !== 1 || buildManifest.status !== 'PASSED' || buildManifest.commit !== commit || buildManifest.version !== version || !Number.isSafeInteger(buildManifest.artifactCount)) fail('RELEASE_EVIDENCE_INVALID')
  exactKeys(checksums, ['schemaVersion', 'status', 'commit', 'version', 'selfHashConvention', 'files'], 'RELEASE_EVIDENCE_INVALID')
  if (checksums.schemaVersion !== 1 || checksums.status !== 'PASSED' || checksums.commit !== commit || checksums.version !== version || typeof checksums.selfHashConvention !== 'string' || checksums.selfHashConvention.length === 0 || !Array.isArray(checksums.files)) fail('RELEASE_EVIDENCE_INVALID')
  if (buildManifest.artifactCount !== checksums.files.length || assetManifest.assets.length !== checksums.files.length) fail('RELEASE_EVIDENCE_INVALID')
  const acceptance = await readFile(join(evidence, 'acceptance.log'), 'utf8').catch(() => fail('RELEASE_EVIDENCE_INVALID'))
  if (acceptance !== `status=PASSED commit=${commit} version=${version} artifacts=${buildManifest.artifactCount}\n`) fail('RELEASE_EVIDENCE_INVALID')
  const checksumEntries = new Map()
  for (const entry of checksums.files) {
    exactKeys(entry, ['path', 'sha256', 'bytes', 'status'], 'RELEASE_EVIDENCE_INVALID')
    if (typeof entry.path !== 'string' || entry.path.length === 0 || entry.path.startsWith('/') || entry.path.startsWith('\\') || entry.path.split(/[\\/]/).some((part) => part === '' || part === '.' || part === '..') || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || checksumEntries.has(entry.path)) fail('RELEASE_EVIDENCE_INVALID')
    if (entry.path === 'checksums.json') {
      if (entry.sha256 !== null || entry.status !== 'SELF_EXCLUDED' || entry.bytes !== checksumsBytes.length) fail('RELEASE_EVIDENCE_INVALID')
    } else if (!/^[0-9a-f]{64}$/.test(entry.sha256) || !['VERIFIED', 'GENERATED'].includes(entry.status)) {
      fail('RELEASE_EVIDENCE_INVALID')
    }
    checksumEntries.set(entry.path, entry)
  }
  if (!checksumEntries.has('checksums.json') || !checksumEntries.has('SHA256SUMS.txt')) fail('RELEASE_EVIDENCE_INVALID')
  const shaSums = shaSumsBytes.toString('utf8')
  if (!shaSums.endsWith('\n')) fail('RELEASE_EVIDENCE_INVALID')
  const shaRows = shaSums.slice(0, -1).split('\n')
  if (shaRows.length === 0 || shaRows.some((line) => !/^[0-9a-f]{64}  [^\r\n]+$/.test(line)) || shaRows.some((line, index) => index > 0 && line <= shaRows[index - 1])) fail('RELEASE_EVIDENCE_INVALID')
  const shaEntries = new Map()
  for (const line of shaRows) {
    const [sha256, path] = [line.slice(0, 64), line.slice(66)]
    if (path.startsWith('/') || path.startsWith('\\') || path.split(/[\\/]/).some((part) => part === '' || part === '.' || part === '..') || shaEntries.has(path)) fail('RELEASE_EVIDENCE_INVALID')
    shaEntries.set(path, sha256)
  }
  const expectedShaEntries = [...checksumEntries.values()].filter((entry) => entry.path !== 'checksums.json' && entry.path !== 'SHA256SUMS.txt')
  if (shaEntries.size !== expectedShaEntries.length || expectedShaEntries.some((entry) => shaEntries.get(entry.path) !== entry.sha256)) fail('RELEASE_EVIDENCE_INVALID')
  const shaSumsEntry = checksumEntries.get('SHA256SUMS.txt')
  if (shaSumsEntry.bytes !== shaSumsBytes.length || shaSumsEntry.sha256 !== createHash('sha256').update(shaSumsBytes).digest('hex')) fail('RELEASE_EVIDENCE_INVALID')
  const names = new Set()
  const assetEntries = new Map()
  const assets = []
  let totalBytes = 0
  for (const asset of assetManifest.assets) {
    exactKeys(asset, ['path', 'name', 'bytes', 'sha256'], 'RELEASE_ASSETS_MANIFEST_INVALID')
    if (typeof asset.path !== 'string' || typeof asset.name !== 'string' || asset.path.length === 0 || asset.name.length === 0 || asset.name !== basename(asset.path) || asset.name.includes('/') || asset.name.includes('\\') || asset.path.startsWith('/') || asset.path.startsWith('\\') || asset.path.split(/[\\/]/).some((part) => part === '' || part === '.' || part === '..') || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0 || asset.bytes > MAX_ASSET_BYTES || !/^[0-9a-f]{64}$/.test(asset.sha256) || names.has(asset.name) || totalBytes + asset.bytes > MAX_TOTAL_ASSET_BYTES) fail('RELEASE_ASSETS_MANIFEST_INVALID')
    if (assetEntries.has(asset.path)) fail('RELEASE_ASSETS_MANIFEST_INVALID')
    names.add(asset.name)
    totalBytes += asset.bytes
    assetEntries.set(asset.path, asset)
  }
  if (assetEntries.size !== checksumEntries.size || [...checksumEntries.keys()].some((path) => !assetEntries.has(path))) fail('RELEASE_EVIDENCE_INVALID')
  for (const [path, checksum] of checksumEntries) {
    const asset = assetEntries.get(path)
    if (asset.name !== basename(path)) fail('RELEASE_ASSETS_MANIFEST_INVALID')
    if (path === 'checksums.json') {
      if (asset.bytes !== checksumsBytes.length || asset.sha256 !== createHash('sha256').update(checksumsBytes).digest('hex') || checksum.bytes !== asset.bytes) fail('RELEASE_EVIDENCE_INVALID')
    } else if (asset.bytes !== checksum.bytes || asset.sha256 !== checksum.sha256) {
      fail('RELEASE_EVIDENCE_INVALID')
    }
  }
  for (const asset of assetManifest.assets) {
    const path = join(evidence, asset.path)
    if (!isStrictDescendant(evidence, path)) fail('RELEASE_ASSETS_MANIFEST_INVALID')
    await assertOrdinaryExistingPath(path, 'RELEASE_ASSET_INVALID')
    const body = await readVerifiedAsset(path, asset.bytes, asset.sha256)
    assets.push({ ...asset, path, body })
  }
  return assets
}

function apiUrl(path) {
  return `https://api.github.com${path}`
}

async function request(fetch, url, init, code) {
  let response
  try {
    response = await fetch(url, init)
  } catch {
    fail(code)
  }
  if (!response?.ok) fail(code)
  return response
}

async function requestJson(fetch, url, init, code) {
  const response = await request(fetch, url, init, code)
  try {
    return await response.json()
  } catch {
    fail(code)
  }
}

async function resolveTagCommit(repository, tag, token, fetch) {
  const reference = await requestJson(fetch, apiUrl(`/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`), { headers: headers(token) }, 'RELEASE_TAG_LOOKUP_FAILED')
  let object = reference?.object
  for (let depth = 0; depth < 8; depth += 1) {
    if (!object || typeof object.sha !== 'string' || !/^[0-9a-f]{40}$/.test(object.sha)) fail('RELEASE_TAG_LOOKUP_FAILED')
    if (object.type === 'commit') return object.sha
    if (object.type !== 'tag') fail('RELEASE_TAG_LOOKUP_FAILED')
    const annotated = await requestJson(fetch, apiUrl(`/repos/${repository}/git/tags/${object.sha}`), { headers: headers(token) }, 'RELEASE_TAG_LOOKUP_FAILED')
    object = annotated?.object
  }
  fail('RELEASE_TAG_LOOKUP_FAILED')
}

function headers(token, extra = {}) {
  return { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', ...extra }
}

async function releaseExists(fetch, repository, tag, token) {
  let response
  try {
    response = await fetch(apiUrl(`/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`), { headers: headers(token) })
  } catch {
    fail('RELEASE_EXISTENCE_LOOKUP_FAILED')
  }
  if (response.status === 404) return false
  if (!response.ok) fail('RELEASE_EXISTENCE_LOOKUP_FAILED')
  return true
}

async function listAssets(fetch, repository, releaseId, token) {
  const assets = await requestJson(fetch, apiUrl(`/repos/${repository}/releases/${releaseId}/assets?per_page=100`), { headers: headers(token) }, 'RELEASE_ASSET_LIST_FAILED')
  if (!Array.isArray(assets)) fail('RELEASE_ASSET_LIST_FAILED')
  return assets
}

export async function publishGitHubRelease(options) {
  const { repository, tag, commit, manifest, evidence, token } = await validateInputs(options)
  const assets = await validateEvidence({ evidence, manifest, commit, tag })
  const fetch = options.fetch ?? globalThis.fetch
  if (typeof fetch !== 'function') fail('RELEASE_FETCH_UNAVAILABLE')
  const target = await resolveTagCommit(repository, tag, token, fetch)
  if (target !== commit) fail('RELEASE_TAG_COMMIT_MISMATCH')
  if (await releaseExists(fetch, repository, tag, token)) fail('RELEASE_ALREADY_EXISTS')
  let releaseId = null
  try {
    const release = await requestJson(fetch, apiUrl(`/repos/${repository}/releases`), {
      method: 'POST', headers: headers(token, { 'content-type': 'application/json' }),
      body: JSON.stringify({ tag_name: tag, target_commitish: commit, draft: true, prerelease: false })
    }, 'RELEASE_CREATE_FAILED')
    if (!Number.isSafeInteger(release?.id) || release.id < 1) fail('RELEASE_CREATE_FAILED')
    releaseId = release.id
    for (const asset of assets) {
      await requestJson(fetch, `https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets?name=${encodeURIComponent(asset.name)}`, {
        method: 'POST', headers: headers(token, { 'content-type': 'application/octet-stream' }), body: asset.body
      }, 'RELEASE_UPLOAD_FAILED')
    }
    const remoteAssets = await listAssets(fetch, repository, releaseId, token)
    for (const asset of assets) {
      const remote = remoteAssets.find((item) => item?.name === asset.name && Number.isSafeInteger(item?.id))
      if (!remote) fail('RELEASE_ASSET_LIST_FAILED')
      const download = await request(fetch, apiUrl(`/repos/${repository}/releases/assets/${remote.id}`), { headers: headers(token, { accept: 'application/octet-stream' }) }, 'RELEASE_ASSET_DOWNLOAD_FAILED')
      const downloaded = Buffer.from(await download.arrayBuffer())
      if (downloaded.length !== asset.bytes || createHash('sha256').update(downloaded).digest('hex') !== asset.sha256) fail('RELEASE_ASSET_DIGEST_MISMATCH')
    }
    await request(fetch, apiUrl(`/repos/${repository}/releases/${releaseId}`), {
      method: 'PATCH', headers: headers(token, { 'content-type': 'application/json' }), body: JSON.stringify({ draft: false })
    }, 'RELEASE_PUBLISH_FAILED')
    releaseId = null
    return { status: 'PUBLISHED', repository, tag, commit, assets: assets.length }
  } catch (error) {
    if (releaseId !== null) {
      try {
        await request(fetch, apiUrl(`/repos/${repository}/releases/${releaseId}`), { method: 'DELETE', headers: headers(token) }, 'RELEASE_DRAFT_CLEANUP_BLOCKED')
      } catch {
        fail('RELEASE_DRAFT_CLEANUP_BLOCKED')
      }
    }
    throw error
  }
}

function parseArguments(argv) {
  if (argv.length !== 10 || argv[0] !== '--repository' || argv[2] !== '--tag' || argv[4] !== '--commit' || argv[6] !== '--assets-manifest' || argv[8] !== '--evidence-dir') fail('RELEASE_ARGUMENTS_INVALID')
  return { repository: argv[1], tag: argv[3], commit: argv[5], assetsManifest: argv[7], evidenceDirectory: argv[9] }
}

async function main() {
  const result = await publishGitHubRelease(parseArguments(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'RELEASE_PUBLISH_FAILED'}\n`)
    process.exitCode = 1
  })
}
