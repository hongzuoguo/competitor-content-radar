import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const FIXED_PUBLIC_ASSETS = [
  'THIRD_PARTY_NOTICES.md',
  'docs/resources-and-licenses.md',
  'engine-manifest.json',
  'engine-provenance.json',
  'guides/competitor-content-radar-user-guide.docx',
  'guides/competitor-content-radar-user-guide.md',
  'latest.yml'
]
const GENERATED_ASSETS = ['SHA256SUMS.txt', 'acceptance.log', 'build-manifest.json', 'checksums.json']
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(code) {
  throw new Error(code)
}

function samePath(left, right) {
  const normalize = (value) => process.platform === 'win32' ? value.toLowerCase() : value
  return normalize(resolve(left)) === normalize(resolve(right))
}

function isStrictDescendant(parent, candidate) {
  const difference = relative(parent, candidate)
  return difference !== '' && !isAbsolute(difference) && difference !== '..' && !difference.startsWith(`..${sep}`) && !difference.startsWith('../') && !difference.startsWith('..\\')
}

function pathsOverlap(left, right) {
  return samePath(left, right) || isStrictDescendant(left, right) || isStrictDescendant(right, left)
}

async function assertOrdinaryExistingPath(path, code) {
  const resolved = resolve(path)
  for (let current = resolved; ; current = dirname(current)) {
    const details = await lstat(current)
    if (details.isSymbolicLink() || !samePath(await realpath(current), current)) fail(code)
    const parent = dirname(current)
    if (parent === current) return resolved
  }
}

async function assertOrdinaryDirectory(path, code) {
  const resolved = await assertOrdinaryExistingPath(path, code)
  if (!(await lstat(resolved)).isDirectory()) fail(code)
  return resolved
}

async function getOrdinaryFileFingerprint(path) {
  const details = await lstat(path)
  if (!details.isFile() || details.isSymbolicLink()) fail('RELEASE_EVIDENCE_ASSET_INVALID')

  const handle = await open(path, 'r')
  try {
    const openDetails = await handle.stat()
    if (!openDetails.isFile()) fail('RELEASE_EVIDENCE_ASSET_INVALID')
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let position = 0
    while (position < openDetails.size) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) fail('RELEASE_EVIDENCE_ASSET_INVALID')
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    return { sha256: hash.digest('hex'), bytes: openDetails.size }
  } finally {
    await handle.close()
  }
}

async function getOrdinaryFileSha512(path) {
  const details = await lstat(path)
  if (!details.isFile() || details.isSymbolicLink()) fail('RELEASE_EVIDENCE_ASSET_INVALID')
  const handle = await open(path, 'r')
  try {
    const openDetails = await handle.stat()
    if (!openDetails.isFile()) fail('RELEASE_EVIDENCE_ASSET_INVALID')
    const hash = createHash('sha512')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let position = 0
    while (position < openDetails.size) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) fail('RELEASE_EVIDENCE_ASSET_INVALID')
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    return hash.digest('base64')
  } finally {
    await handle.close()
  }
}

async function listOrdinaryFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name)
    if (entry.isSymbolicLink()) fail('RELEASE_EVIDENCE_ASSET_INVALID')
    if (entry.isDirectory()) {
      files.push(...await listOrdinaryFiles(root, absolutePath))
    } else if (entry.isFile()) {
      const publicPath = relative(root, absolutePath).replaceAll('\\', '/')
      if (!publicPath || publicPath.startsWith('../') || publicPath.includes('/../')) fail('RELEASE_EVIDENCE_ASSET_INVALID')
      files.push(publicPath)
    } else {
      fail('RELEASE_EVIDENCE_ASSET_INVALID')
    }
  }
  return files
}

function expectedAssetNames(version, commit) {
  const shortCommit = commit.slice(0, 7)
  return new Set([
    ...FIXED_PUBLIC_ASSETS,
    `HitMuse-${version}-${shortCommit}-setup.exe`,
    `HitMuse-${version}-${shortCommit}-setup.exe.blockmap`
  ])
}

function readYamlScalar(value) {
  const trimmed = value.trim()
  if (trimmed.length === 0) fail('RELEASE_EVIDENCE_UPDATER_INVALID')
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      fail('RELEASE_EVIDENCE_UPDATER_INVALID')
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    if (trimmed.slice(1, -1).includes("'")) fail('RELEASE_EVIDENCE_UPDATER_INVALID')
    return trimmed.slice(1, -1)
  }
  if (/\s|[#{}\[\],&*!|>@`]/.test(trimmed)) fail('RELEASE_EVIDENCE_UPDATER_INVALID')
  return trimmed
}

function renderYamlScalar(value, replacement) {
  const trimmed = value.trim()
  if (trimmed.startsWith('"')) return JSON.stringify(replacement)
  if (trimmed.startsWith("'")) return `'${replacement}'`
  return replacement
}

function normalizeLatestYml(contents, version, canonicalInstaller, installerBytes, installerSha512) {
  const sourceInstaller = `competitor-content-radar-setup-${version}.exe`
  const source = contents.toString('utf8')
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const hasTrailingNewline = source.endsWith('\n')
  const lines = source.split(/\r?\n/)
  if (hasTrailingNewline) lines.pop()

  const rootFields = new Map()
  const fileUrls = []
  let filesSections = 0
  let inFiles = false
  let sha512Fields = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^files:\s*$/.test(line)) {
      filesSections += 1
      inFiles = true
      continue
    }
    if (/^\S/.test(line) && line.trim() !== '') inFiles = false

    const field = line.match(/^(\s*)(-\s+)?([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/)
    if (!field) continue
    const [, indent, listPrefix = '', key, rawValue] = field
    const value = readYamlScalar(rawValue)
    const isRoot = indent.length === 0 && listPrefix === ''

    if (value.endsWith('.exe') && key !== 'path' && key !== 'url') fail('RELEASE_EVIDENCE_UPDATER_INVALID')
    if (key === 'version' || key === 'path') {
      if (!isRoot || rootFields.has(key)) fail('RELEASE_EVIDENCE_UPDATER_INVALID')
      rootFields.set(key, { index, value, rawValue })
      continue
    }
    if (key === 'sha512') {
      if (value !== installerSha512) fail('RELEASE_EVIDENCE_UPDATER_INVALID')
      sha512Fields += 1
      continue
    }
    if (key === 'size') {
      const bytes = Number(value)
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(bytes) || bytes !== installerBytes) fail('RELEASE_EVIDENCE_UPDATER_INVALID')
      continue
    }
    if (key === 'url') {
      if (!inFiles || value !== sourceInstaller) fail('RELEASE_EVIDENCE_UPDATER_INVALID')
      fileUrls.push({ index, rawValue })
    }
  }

  if (filesSections !== 1 || rootFields.get('version')?.value !== version || rootFields.get('path')?.value !== sourceInstaller ||
    fileUrls.length !== 1 || sha512Fields !== 2) {
    fail('RELEASE_EVIDENCE_UPDATER_INVALID')
  }

  const rewrite = (entry) => {
    lines[entry.index] = lines[entry.index].replace(entry.rawValue, renderYamlScalar(entry.rawValue, canonicalInstaller))
  }
  rewrite(rootFields.get('path'))
  for (const url of fileUrls) rewrite(url)
  return `${lines.join(newline)}${hasTrailingNewline ? newline : ''}`
}

function validateOptions(options) {
  if (!options || typeof options !== 'object') fail('RELEASE_EVIDENCE_OPTIONS_INVALID')
  const { sourceRoot, outputRoot, commit, version } = options
  if (typeof sourceRoot !== 'string' || typeof outputRoot !== 'string' || typeof commit !== 'string' || typeof version !== 'string') {
    fail('RELEASE_EVIDENCE_OPTIONS_INVALID')
  }
  if (!isAbsolute(sourceRoot) || !isAbsolute(outputRoot) || !COMMIT_PATTERN.test(commit) || !VERSION_PATTERN.test(version)) {
    fail('RELEASE_EVIDENCE_OPTIONS_INVALID')
  }
  return { sourceRoot: resolve(sourceRoot), outputRoot: resolve(outputRoot), commit, version }
}

async function writeNewFile(path, content) {
  const handle = await open(path, 'wx')
  try {
    await handle.writeFile(content, 'utf8')
  } finally {
    await handle.close()
  }
}

/**
 * Produces public, commit-bound evidence from a pre-validated staging folder.
 * The output contains only relative public asset names, hashes, byte counts,
 * version/commit values, and fixed status markers.  `checksums.json` records
 * its own byte count but intentionally omits its SHA-256: no SHA256SUMS-style
 * manifest can contain a truthful hash of its final self without a cycle.
 */
export async function generateReleaseEvidence(options) {
  const { sourceRoot, outputRoot, commit, version } = validateOptions(options)
  if (pathsOverlap(sourceRoot, outputRoot) || pathsOverlap(REPOSITORY_ROOT, sourceRoot) || pathsOverlap(REPOSITORY_ROOT, outputRoot)) {
    fail('RELEASE_EVIDENCE_PATH_INVALID')
  }

  const source = await assertOrdinaryDirectory(sourceRoot, 'RELEASE_EVIDENCE_SOURCE_INVALID')
  const outputParent = await assertOrdinaryDirectory(dirname(outputRoot), 'RELEASE_EVIDENCE_OUTPUT_INVALID')
  if (!isStrictDescendant(outputParent, outputRoot)) fail('RELEASE_EVIDENCE_PATH_INVALID')
  try {
    await lstat(outputRoot)
    fail('RELEASE_EVIDENCE_OUTPUT_EXISTS')
  } catch (error) {
    if (error instanceof Error && error.message === 'RELEASE_EVIDENCE_OUTPUT_EXISTS') throw error
    if (error?.code !== 'ENOENT') throw error
  }

  const sourcePaths = await listOrdinaryFiles(source)
  const expected = expectedAssetNames(version, commit)
  if (sourcePaths.length !== expected.size || sourcePaths.some((path) => !expected.has(path))) {
    fail('RELEASE_EVIDENCE_ASSET_INVALID')
  }

  const canonicalInstaller = `HitMuse-${version}-${commit.slice(0, 7)}-setup.exe`
  const installerPath = join(source, canonicalInstaller)
  const installer = await getOrdinaryFileFingerprint(installerPath)
  const normalizedLatestYml = normalizeLatestYml(
    await readFile(join(source, 'latest.yml')),
    version,
    canonicalInstaller,
    installer.bytes,
    await getOrdinaryFileSha512(installerPath)
  )

  try {
    await mkdir(outputRoot)
  } catch (error) {
    if (error?.code === 'EEXIST') fail('RELEASE_EVIDENCE_OUTPUT_EXISTS')
    throw error
  }

  const assets = []
  for (const path of [...sourcePaths].sort()) {
    const sourcePath = resolve(source, path)
    const outputPath = join(outputRoot, path)
    if (!isStrictDescendant(source, sourcePath) || !isStrictDescendant(outputRoot, outputPath)) fail('RELEASE_EVIDENCE_ASSET_INVALID')
    await mkdir(dirname(outputPath), { recursive: true })
    if (path === 'latest.yml') {
      await writeNewFile(outputPath, normalizedLatestYml)
    } else {
      await copyFile(sourcePath, outputPath)
    }
    assets.push({ path, ...await getOrdinaryFileFingerprint(outputPath), status: 'VERIFIED' })
  }

  const artifactCount = assets.length + GENERATED_ASSETS.length
  const buildManifest = { schemaVersion: 1, status: 'PASSED', commit, version, artifactCount }
  await writeNewFile(join(outputRoot, 'build-manifest.json'), `${JSON.stringify(buildManifest, null, 2)}\n`)
  await writeNewFile(join(outputRoot, 'acceptance.log'), `status=PASSED commit=${commit} version=${version} artifacts=${artifactCount}\n`)

  const generatedBeforeChecksums = [
    { path: 'acceptance.log', ...await getOrdinaryFileFingerprint(join(outputRoot, 'acceptance.log')), status: 'GENERATED' },
    { path: 'build-manifest.json', ...await getOrdinaryFileFingerprint(join(outputRoot, 'build-manifest.json')), status: 'GENERATED' }
  ]
  const checksumRows = [...assets, ...generatedBeforeChecksums].map((asset) => `${asset.sha256}  ${asset.path}`).sort()
  await writeNewFile(join(outputRoot, 'SHA256SUMS.txt'), `${checksumRows.join('\n')}\n`)
  generatedBeforeChecksums.push({
    path: 'SHA256SUMS.txt', ...await getOrdinaryFileFingerprint(join(outputRoot, 'SHA256SUMS.txt')), status: 'GENERATED'
  })

  const persistedFiles = [...assets, ...generatedBeforeChecksums, {
    path: 'checksums.json', sha256: null, bytes: 0, status: 'SELF_EXCLUDED'
  }].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  const selfHashConvention = 'checksums.json records its final byte count and intentionally omits its SHA-256 to avoid a self-hash cycle.'
  let checksums
  let checksumsContent
  while (true) {
    checksums = { schemaVersion: 1, status: 'PASSED', commit, version, selfHashConvention, files: persistedFiles }
    checksumsContent = `${JSON.stringify(checksums, null, 2)}\n`
    const selfAsset = persistedFiles.find((asset) => asset.path === 'checksums.json')
    const byteCount = Buffer.byteLength(checksumsContent, 'utf8')
    if (selfAsset.bytes === byteCount) break
    selfAsset.bytes = byteCount
  }
  await writeNewFile(join(outputRoot, 'checksums.json'), checksumsContent)

  const uploadAssets = [...persistedFiles.filter((asset) => asset.path !== 'checksums.json'), {
    path: 'checksums.json', ...await getOrdinaryFileFingerprint(join(outputRoot, 'checksums.json'))
  }].map((asset) => ({ path: asset.path, name: asset.path.split('/').at(-1), bytes: asset.bytes, sha256: asset.sha256 }))
  if (new Set(uploadAssets.map((asset) => asset.name)).size !== uploadAssets.length || uploadAssets.some((asset) => !/^[0-9a-f]{64}$/.test(asset.sha256))) {
    fail('RELEASE_EVIDENCE_ASSET_INVALID')
  }
  await writeNewFile(join(outputRoot, 'assets-manifest.json'), `${JSON.stringify({ schemaVersion: 1, commit, version, assets: uploadAssets }, null, 2)}\n`)

  return checksums
}

async function main() {
  const [sourceRoot, outputRoot, commit, version] = process.argv.slice(2)
  const result = await generateReleaseEvidence({ sourceRoot, outputRoot, commit, version })
  process.stdout.write(`${JSON.stringify({ status: result.status, commit: result.commit, files: result.files.length })}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'RELEASE_EVIDENCE_FAILED'}\n`)
    process.exitCode = 1
  })
}
