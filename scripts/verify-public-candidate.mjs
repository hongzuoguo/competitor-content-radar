import { createHash } from 'node:crypto'
import { lstat, open, readdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ALLOWLIST_PATH = 'config/public-tree-allowlist.json'
const TRUSTED_ALLOWLIST_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', ALLOWLIST_PATH)
const POLICY_KEYS = ['version', 'allowedPaths', 'binaryPaths', 'deniedPaths', 'contentRules', 'limits']
const LIMITS = { maxFiles: 5000, maxDepth: 20, maxFileBytes: 33554432, maxTotalBytes: 268435456, maxErrors: 100 }
const decoder = new TextDecoder('utf-8', { fatal: true })

function safeError(ruleId, relativePath, fileSha256 = null) { return { ruleId, relativePath, fileSha256 } }
function toRelativePath(candidate, path) { return relative(candidate, path).split(sep).join('/') || '.' }
function hash(content) { return createHash('sha256').update(content).digest('hex') }
function sameStats(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs
    && left.isFile() === right.isFile() && left.isDirectory() === right.isDirectory() && left.isSymbolicLink() === right.isSymbolicLink()
}

function globMatches(pattern, path) {
  let expression = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') { expression += '(?:.*/)?'; index += 2 } else { expression += '.*'; index += 1 }
    } else if (character === '*') expression += '[^/]*'
    else expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
  }
  return new RegExp(`${expression}$`).test(path)
}

function isValidGlob(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0 || isAbsolute(pattern) || pattern.split('/').includes('..')) return false
  try { globMatches(pattern, ''); return true } catch { return false }
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && Object.keys(value).length === keys.length && keys.every((key) => key in value)
}

function parseAllowlist(value) {
  if (!exactKeys(value, POLICY_KEYS) || value.version !== 1 || !Array.isArray(value.allowedPaths) || !Array.isArray(value.binaryPaths)
    || !Array.isArray(value.deniedPaths) || !Array.isArray(value.contentRules) || !exactKeys(value.limits, Object.keys(LIMITS))) return null
  if (!Object.entries(LIMITS).every(([key, limit]) => value.limits[key] === limit)) return null
  if (!value.allowedPaths.every(isValidGlob) || !value.binaryPaths.every((path) => isValidGlob(path) && !path.includes('*'))) return null
  if (!value.deniedPaths.every((rule) => exactKeys(rule, ['ruleId', 'patterns']) && typeof rule.ruleId === 'string' && rule.ruleId.length > 0
    && Array.isArray(rule.patterns) && rule.patterns.every(isValidGlob))) return null
  if (!value.contentRules.every((rule) => exactKeys(rule, ['ruleId', 'base64Literals']) && typeof rule.ruleId === 'string' && rule.ruleId.length > 0
    && Array.isArray(rule.base64Literals) && rule.base64Literals.every((literal) => typeof literal === 'string' && literal.length > 0
      && Buffer.from(literal, 'base64').length > 0 && Buffer.from(literal, 'base64').toString('base64') === literal))) return null
  const ruleIds = [...value.deniedPaths, ...value.contentRules].map((rule) => rule.ruleId)
  return new Set(ruleIds).size === ruleIds.length ? value : null
}

async function loadTrustedAllowlist() {
  try {
    const content = await readFile(TRUSTED_ALLOWLIST_PATH)
    const allowlist = parseAllowlist(JSON.parse(decoder.decode(content)))
    return allowlist ? { allowlist, content } : null
  } catch { return null }
}

async function readExact(handle, size) {
  const content = Buffer.allocUnsafe(size)
  for (let offset = 0; offset < size;) {
    const { bytesRead } = await handle.read(content, offset, size - offset, offset)
    if (bytesRead === 0) throw new Error('CANDIDATE_EOF_EARLY')
    offset += bytesRead
  }
  return content
}

function canonicalizePolicyLineEndings(content) {
  const bytes = []
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== 0x0d) {
      bytes.push(content[index])
      continue
    }
    if (content[index + 1] !== 0x0a) return null
    bytes.push(0x0a)
    index += 1
  }
  return Buffer.from(bytes)
}

function policyByteLengths(canonicalPolicy) {
  const crlfLength = canonicalPolicy.length + canonicalPolicy.reduce((count, byte) => count + (byte === 0x0a ? 1 : 0), 0)
  return new Set([canonicalPolicy.length, crlfLength])
}

async function verifyCandidatePolicy(candidate, trustedPolicy, hooks) {
  const path = resolve(candidate, ALLOWLIST_PATH)
  try {
    const before = await lstat(path)
    if (!before.isFile() || before.isSymbolicLink()) return safeError('ALLOWLIST_POLICY_MISMATCH', ALLOWLIST_PATH)
    const handle = await open(path, 'r')
    let content
    try {
      if (!sameStats(before, await handle.stat())) return safeError('CANDIDATE_CHANGED_DURING_SCAN', ALLOWLIST_PATH)
      const canonicalTrustedPolicy = canonicalizePolicyLineEndings(trustedPolicy)
      if (!canonicalTrustedPolicy || !policyByteLengths(canonicalTrustedPolicy).has(before.size)) {
        return safeError('ALLOWLIST_POLICY_MISMATCH', ALLOWLIST_PATH)
      }
      await hooks.beforeCandidatePolicyRead?.(path)
      content = await readExact(handle, before.size)
      if (!sameStats(before, await handle.stat()) || !sameStats(before, await lstat(path))) return safeError('CANDIDATE_CHANGED_DURING_SCAN', ALLOWLIST_PATH)
    } finally { await handle.close() }
    const canonicalCandidatePolicy = canonicalizePolicyLineEndings(content)
    return canonicalCandidatePolicy?.equals(canonicalizePolicyLineEndings(trustedPolicy))
      ? null : safeError('ALLOWLIST_POLICY_MISMATCH', ALLOWLIST_PATH, hash(content))
  } catch { return safeError('ALLOWLIST_POLICY_MISMATCH', ALLOWLIST_PATH) }
}

function hasBom(content) {
  return (content[0] === 0xff && content[1] === 0xfe) || (content[0] === 0xfe && content[1] === 0xff)
}

async function hashFile(handle, size) {
  const digest = createHash('sha256')
  if (size === 0) return digest.digest('hex')
  for await (const chunk of handle.createReadStream({ start: 0, end: size - 1, autoClose: false })) digest.update(chunk)
  return digest.digest('hex')
}

async function ancestorsAreOrdinary(candidate) {
  for (let path = dirname(candidate); ; path = dirname(path)) {
    try { if ((await lstat(path)).isSymbolicLink()) return false } catch { return false }
    if (dirname(path) === path) return true
  }
}

export async function verifyPublicCandidate(candidate, hooks = {}) {
  if (!isAbsolute(candidate)) return [safeError('CANDIDATE_PATH_NOT_ABSOLUTE', '.')]
  if (!await ancestorsAreOrdinary(candidate)) return [safeError('CANDIDATE_ANCESTOR_REPARSE_POINT', '.')]
  let rootStats
  try { rootStats = await lstat(candidate) } catch { return [safeError('CANDIDATE_NOT_FOUND', '.')] }
  if (rootStats.isSymbolicLink()) return [safeError('CANDIDATE_ROOT_REPARSE_POINT', '.')]
  if (!rootStats.isDirectory()) return [safeError('CANDIDATE_NOT_DIRECTORY', '.')]
  const trusted = await loadTrustedAllowlist()
  if (!trusted) return [safeError('TRUSTED_ALLOWLIST_INVALID', ALLOWLIST_PATH)]
  const policyError = await verifyCandidatePolicy(candidate, trusted.content, hooks)
  if (policyError) return [policyError]

  const { allowlist } = trusted
  const errors = []
  let files = 0
  let totalBytes = 0
  const report = (ruleId, relativePath, fileSha256 = null) => {
    if (errors.length >= allowlist.limits.maxErrors) return false
    if (errors.length + 1 === allowlist.limits.maxErrors) {
      errors.push(safeError('MAX_ERRORS_EXCEEDED', relativePath, fileSha256))
      return false
    }
    errors.push(safeError(ruleId, relativePath, fileSha256))
    return errors.length < allowlist.limits.maxErrors
  }

  async function inspect(path, depth) {
    if (errors.length >= allowlist.limits.maxErrors) return false
    const relativePath = toRelativePath(candidate, path)
    if (depth > allowlist.limits.maxDepth) return report('MAX_DEPTH_EXCEEDED', relativePath)
    let before
    try { before = await lstat(path) } catch { return report('CANDIDATE_UNREADABLE', relativePath) }
    if (before.isSymbolicLink()) return report('REPARSE_POINT', relativePath)
    if (before.isDirectory()) {
      const denied = allowlist.deniedPaths.find((rule) => rule.patterns.some((pattern) => globMatches(pattern, `${relativePath}/.directory`)))
      if (denied) return report(denied.ruleId, relativePath)
      const entries = await readdir(path)
      await hooks.afterDirectoryRead?.(path)
      if (!sameStats(before, await lstat(path))) return report('CANDIDATE_CHANGED_DURING_SCAN', relativePath)
      for (const entry of entries.sort()) if (!await inspect(resolve(path, entry), depth + 1)) return false
      return sameStats(before, await lstat(path)) ? true : report('CANDIDATE_CHANGED_DURING_SCAN', relativePath)
    }
    if (!before.isFile()) return report('UNSUPPORTED_FILE_TYPE', relativePath)
    const denied = allowlist.deniedPaths.find((rule) => rule.patterns.some((pattern) => globMatches(pattern, relativePath)))
    if (denied) return report(denied.ruleId, relativePath)
    const binary = allowlist.binaryPaths.some((pattern) => globMatches(pattern, relativePath))
    if (!binary && !allowlist.allowedPaths.some((pattern) => globMatches(pattern, relativePath))) return report('PATH_NOT_ALLOWLISTED', relativePath)
    try {
      await hooks.beforeFileOpen?.(path)
      const handle = await open(path, 'r')
      try {
        const opened = await handle.stat()
        if (!sameStats(before, opened) || !opened.isFile()) return report('CANDIDATE_CHANGED_DURING_SCAN', relativePath)
        await hooks.afterFileHandleStat?.(path)
        files += 1
        totalBytes += opened.size
        if (files > allowlist.limits.maxFiles) return report('MAX_FILES_EXCEEDED', relativePath)
        if (totalBytes > allowlist.limits.maxTotalBytes) return report('MAX_TOTAL_BYTES_EXCEEDED', relativePath)
        if (opened.size > allowlist.limits.maxFileBytes) return report('MAX_FILE_BYTES_EXCEEDED', relativePath)
        if (binary) {
          const fileSha256 = await hashFile(handle, opened.size)
          return sameStats(before, await handle.stat()) && sameStats(before, await lstat(path))
            ? true : report('CANDIDATE_CHANGED_DURING_SCAN', relativePath, fileSha256)
        }
        const content = await readExact(handle, opened.size)
        if (!sameStats(before, await handle.stat()) || !sameStats(before, await lstat(path))) return report('CANDIDATE_CHANGED_DURING_SCAN', relativePath)
        if (hasBom(content)) return report('TEXT_ENCODING_INVALID', relativePath, hash(content))
        let text
        try { text = decoder.decode(content) } catch { return report('TEXT_ENCODING_INVALID', relativePath, hash(content)) }
        for (const rule of allowlist.contentRules) {
          if (rule.base64Literals.some((literal) => text.includes(Buffer.from(literal, 'base64').toString('utf8')))) return report(rule.ruleId, relativePath, hash(content))
        }
        return true
      } finally { await handle.close() }
    } catch {
      return report('CANDIDATE_CHANGED_DURING_SCAN', relativePath)
    }
  }

  try {
    const entries = await readdir(candidate)
    if (!sameStats(rootStats, await lstat(candidate))) return [safeError('CANDIDATE_CHANGED_DURING_SCAN', '.')]
    for (const entry of entries.sort()) if (!await inspect(resolve(candidate, entry), 1)) break
    if (!sameStats(rootStats, await lstat(candidate))) return [safeError('CANDIDATE_CHANGED_DURING_SCAN', '.')]
  } catch { return [safeError('CANDIDATE_UNREADABLE', '.')] }
  return errors
}

async function main() {
  const candidate = process.argv.length === 4 && process.argv[2] === '--candidate' ? process.argv[3] : null
  const errors = candidate === null ? [safeError('CANDIDATE_ARGUMENTS_INVALID', '.')] : await verifyPublicCandidate(candidate)
  process.stdout.write(`${JSON.stringify({ errors })}\n`)
  if (errors.length) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
