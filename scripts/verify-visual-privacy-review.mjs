import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditReparsePoints } from './build-visual-privacy-manifest.mjs'

const DEFAULT_APPROVED_REVIEW_ROOT = resolve('E:\\10500\\radar-build\\reviews')
const SHA256 = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/

function fail() {
  throw new Error('VISUAL_PRIVACY_REVIEW_INVALID')
}

function pathEquals(left, right) {
  const normalize = (path) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
  return normalize(left) === normalize(right)
}

function isStrictDescendant(parent, candidate) {
  const pathFromParent = relative(parent, candidate)
  return pathFromParent !== '' && pathFromParent !== '..' && !pathFromParent.startsWith('..\\') && !pathFromParent.startsWith('../') && !isAbsolute(pathFromParent)
}

function isSameOrDescendant(parent, candidate) {
  return pathEquals(parent, candidate) || isStrictDescendant(parent, candidate)
}

function existingAncestors(path) {
  const ancestors = []
  for (let current = resolve(path); ; current = dirname(current)) {
    ancestors.push(current)
    const parent = dirname(current)
    if (parent === current) return ancestors
  }
}

function assertOrdinaryPath(path, expectedType) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail()
  const resolved = resolve(path)
  for (const current of existingAncestors(resolved)) {
    let entry
    try {
      entry = lstatSync(current)
      if (entry.isSymbolicLink() || !pathEquals(realpathSync.native(current), current)) fail()
      if (current === resolved && (expectedType === 'file' ? !entry.isFile() : !entry.isDirectory())) fail()
      if (current !== resolved && !entry.isDirectory()) fail()
    } catch {
      fail()
    }
  }
  return resolved
}

function assertExactKeys(value, keys) {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) fail()
}

function readStableJson(path) {
  const before = lstatSync(path)
  let contents
  let value
  try {
    contents = readFileSync(path)
    value = JSON.parse(contents.toString('utf8'))
  } catch {
    fail()
  }
  const after = lstatSync(path)
  if (before.isSymbolicLink() || !before.isFile() || after.isSymbolicLink() || !after.isFile() ||
    before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail()
  return { contents, value }
}

function assertManifest(value) {
  assertExactKeys(value, ['assets'])
  if (!Array.isArray(value.assets)) fail()
  const assets = new Map()
  for (const asset of value.assets) {
    assertExactKeys(asset, ['path', 'bytes', 'sha256', 'status'])
    if (typeof asset.path !== 'string' || asset.path.length === 0 || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0 ||
      typeof asset.sha256 !== 'string' || !SHA256.test(asset.sha256) || asset.status !== 'REVIEW_REQUIRED' || assets.has(asset.path)) fail()
    assets.set(asset.path, { bytes: asset.bytes, sha256: asset.sha256 })
  }
  return assets
}

function assertReview(value, manifestAssets, commit, manifestSha256) {
  assertExactKeys(value, ['schemaVersion', 'commit', 'visualManifestSha256', 'assets'])
  if (value.schemaVersion !== 1 || value.commit !== commit || value.visualManifestSha256 !== manifestSha256 || !Array.isArray(value.assets) || value.assets.length !== manifestAssets.size) fail()
  const reviewedPaths = new Set()
  for (const asset of value.assets) {
    assertExactKeys(asset, ['path', 'bytes', 'sha256', 'result'])
    if (typeof asset.path !== 'string' || !reviewedPaths.add(asset.path) || asset.result !== 'PASS') fail()
    const manifestAsset = manifestAssets.get(asset.path)
    if (!manifestAsset || asset.bytes !== manifestAsset.bytes || asset.sha256 !== manifestAsset.sha256) fail()
  }
}

function assertReviewBinding(value) {
  assertExactKeys(value, ['schemaVersion', 'commit', 'visualManifestSha256', 'assets'])
  if (value.schemaVersion !== 1 || typeof value.commit !== 'string' || !COMMIT.test(value.commit) ||
    typeof value.visualManifestSha256 !== 'string' || !SHA256.test(value.visualManifestSha256) || !Array.isArray(value.assets)) fail()
  return { commit: value.commit, visualManifestSha256: value.visualManifestSha256 }
}

export async function readVisualPrivacyReviewBinding(options) {
  try {
    if (!options || typeof options !== 'object') fail()
    const review = assertOrdinaryPath(options.review, 'file')
    const reviewRoot = assertOrdinaryPath(options.reviewRoot ?? DEFAULT_APPROVED_REVIEW_ROOT, 'directory')
    if (!isStrictDescendant(reviewRoot, review)) fail()
    auditReparsePoints({
      exactPaths: [...new Set([...existingAncestors(review), ...existingAncestors(reviewRoot)])],
      recursiveRoots: [],
      maxDepth: 0,
      maxAuditEntries: 0
    })
    return assertReviewBinding(readStableJson(review).value)
  } catch {
    fail()
  }
}

export async function validateVisualPrivacyReview(options) {
  try {
    if (!options || typeof options !== 'object' || typeof options.commit !== 'string' || !COMMIT.test(options.commit)) fail()
    const manifest = assertOrdinaryPath(options.manifest, 'file')
    const review = assertOrdinaryPath(options.review, 'file')
    const reviewRoot = assertOrdinaryPath(options.reviewRoot ?? DEFAULT_APPROVED_REVIEW_ROOT, 'directory')
    if (!isStrictDescendant(reviewRoot, review) || isSameOrDescendant(dirname(manifest), reviewRoot) || isSameOrDescendant(reviewRoot, dirname(manifest))) fail()
    auditReparsePoints({
      exactPaths: [...new Set([...existingAncestors(manifest), ...existingAncestors(review), ...existingAncestors(reviewRoot)])],
      recursiveRoots: [],
      maxDepth: 0,
      maxAuditEntries: 0
    })
    const loadedManifest = readStableJson(manifest)
    const manifestAssets = assertManifest(loadedManifest.value)
    const manifestSha256 = createHash('sha256').update(loadedManifest.contents).digest('hex')
    const loadedReview = readStableJson(review)
    assertReview(loadedReview.value, manifestAssets, options.commit, manifestSha256)
    return { assets: manifestAssets.size }
  } catch {
    fail()
  }
}

function parseArguments(args) {
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (typeof flag !== 'string' || typeof value !== 'string' || !flag.startsWith('--') || values.has(flag)) fail()
    values.set(flag, value)
  }
  if (values.size < 3 || values.size > 4 || !values.has('--manifest') || !values.has('--review') || !values.has('--commit')) fail()
  if ([...values.keys()].some((flag) => !['--manifest', '--review', '--commit', '--review-root'].includes(flag))) fail()
  return {
    manifest: values.get('--manifest'),
    review: values.get('--review'),
    commit: values.get('--commit'),
    reviewRoot: values.get('--review-root')
  }
}

function parseBindingArguments(args) {
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (typeof flag !== 'string' || typeof value !== 'string' || !flag.startsWith('--') || values.has(flag)) fail()
    values.set(flag, value)
  }
  if (values.size !== 3 || !values.has('--review') || !values.has('--review-root') || !values.has('--binding-output')) fail()
  return {
    review: values.get('--review'),
    reviewRoot: values.get('--review-root'),
    bindingOutput: values.get('--binding-output')
  }
}

function writeBinding(path, binding) {
  const output = resolve(path)
  const parent = assertOrdinaryPath(dirname(output), 'directory')
  if (!isStrictDescendant(parent, output)) fail()
  try {
    writeFileSync(output, `${JSON.stringify(binding)}\n`, { encoding: 'utf8', flag: 'wx' })
  } catch {
    fail()
  }
}

function isMainModule() {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isMainModule()) {
  try {
    if (process.argv[2] === '--read-binding') {
      const options = parseBindingArguments(process.argv.slice(3))
      writeBinding(options.bindingOutput, await readVisualPrivacyReviewBinding(options))
      process.stdout.write('VISUAL_PRIVACY_REVIEW_BINDING_READ\n')
    } else {
      await validateVisualPrivacyReview(parseArguments(process.argv.slice(2)))
      process.stdout.write('VISUAL_PRIVACY_REVIEW_PASSED\n')
    }
  } catch {
    process.stderr.write('VISUAL_PRIVACY_REVIEW_INVALID\n')
    process.exitCode = 1
  }
}
