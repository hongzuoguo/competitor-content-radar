import { closeSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const MAX_FILE_BYTES = 64 * 1024 * 1024
const MAX_FILES = 5_000
const MAX_DEPTH = 20
const MAX_TOTAL_BYTES = 256 * 1024 * 1024
const CHUNK_BYTES = 64 * 1024

export interface PrivacyScanResult {
  passed: boolean | null
  present: boolean
  path: string
  ruleId: string
  status: 'PRODUCED' | 'NOT_PRODUCED' | 'SCAN_FAILED'
  errorCode?: string
}

export interface PrivacyAbsenceResult {
  passed: boolean | null
  present: boolean | null
  path: string
  ruleId: string
  status: 'PRODUCED' | 'NOT_PRODUCED' | 'SCAN_FAILED'
  errorCode?: string
}

export function scanForbiddenMedia(
  rules: ReadonlyArray<{ path: string, ruleId: string }>,
  sentinels: ReadonlyArray<string>
): PrivacyScanResult[] {
  const needles = sentinels.map((sentinel) => Buffer.from(sentinel, 'utf8'))
  return rules.map((rule) => scanRule(rule, needles))
}

export function requireAbsent(
  path: string,
  ruleId: string,
  options: { lstat?: (path: string) => unknown } = {}
): PrivacyAbsenceResult {
  try {
    const lstat = options.lstat ?? lstatSync
    lstat(path)
    return { status: 'PRODUCED', passed: false, present: true, path, ruleId }
  } catch (error) {
    if (isMissing(error)) return { status: 'NOT_PRODUCED', passed: true, present: false, path, ruleId }
    return { status: 'SCAN_FAILED', passed: null, present: null, path, ruleId, errorCode: 'ABSENCE_CHECK_FAILED' }
  }
}

function scanRule(rule: { path: string, ruleId: string }, needles: Buffer[]): PrivacyScanResult {
  let entry: ReturnType<typeof lstatSync>
  try {
    entry = lstatSync(rule.path)
  } catch (error) {
    if (isMissing(error)) return result(rule, 'NOT_PRODUCED', false, null)
    return result(rule, 'SCAN_FAILED', true, null, 'PRIVACY_MEDIA_LSTAT_FAILED')
  }
  try {
    if (isReparsePoint(rule.path, entry)) throw new ScanFailure('PRIVACY_MEDIA_REPARSE_POINT')
    const state = { fileCount: 0, totalBytes: 0, maxNeedleLength: Math.max(0, ...needles.map((needle) => needle.length)) }
    const leaked = scanEntry(rule.path, entry, needles, state, 0)
    return result(rule, 'PRODUCED', true, !leaked)
  } catch (error) {
    return result(rule, 'SCAN_FAILED', true, null, scanErrorCode(error))
  }
}

function scanEntry(
  path: string,
  entry: ReturnType<typeof lstatSync>,
  needles: Buffer[],
  state: { fileCount: number, totalBytes: number, maxNeedleLength: number },
  depth: number
): boolean {
  if (isReparsePoint(path, entry)) throw new ScanFailure('PRIVACY_MEDIA_REPARSE_POINT')
  if (entry.isDirectory()) {
    if (depth > MAX_DEPTH) throw new ScanFailure('PRIVACY_MEDIA_DEPTH_LIMIT')
    let names: string[]
    try {
      names = readdirSync(path)
    } catch {
      throw new ScanFailure('PRIVACY_MEDIA_READDIR_FAILED')
    }
    for (const name of names) {
      const childPath = join(path, name)
      let child: ReturnType<typeof lstatSync>
      try {
        child = lstatSync(childPath)
      } catch {
        throw new ScanFailure('PRIVACY_MEDIA_LSTAT_FAILED')
      }
      if (scanEntry(childPath, child, needles, state, depth + 1)) return true
    }
    return false
  }
  if (!entry.isFile()) throw new ScanFailure('PRIVACY_MEDIA_UNSUPPORTED')
  if (entry.size > MAX_FILE_BYTES) throw new ScanFailure('PRIVACY_MEDIA_FILE_LIMIT')
  if (++state.fileCount > MAX_FILES) throw new ScanFailure('PRIVACY_MEDIA_FILE_COUNT_LIMIT')
  if (state.totalBytes + entry.size > MAX_TOTAL_BYTES) throw new ScanFailure('PRIVACY_MEDIA_TOTAL_BYTES_LIMIT')
  state.totalBytes += entry.size
  return fileContainsSentinel(path, entry.size, needles, state.maxNeedleLength)
}

function fileContainsSentinel(path: string, expectedBytes: number, needles: Buffer[], maxNeedleLength: number): boolean {
  let descriptor: number
  try {
    descriptor = openSync(path, 'r')
  } catch {
    throw new ScanFailure('PRIVACY_MEDIA_OPEN_FAILED')
  }
  try {
    const chunk = Buffer.alloc(CHUNK_BYTES)
    const overlap = Math.max(0, maxNeedleLength - 1)
    let tail = Buffer.alloc(0)
    let readTotal = 0
    while (true) {
      let bytesRead: number
      try {
        bytesRead = readSync(descriptor, chunk, 0, chunk.length, null)
      } catch {
        throw new ScanFailure('PRIVACY_MEDIA_READ_FAILED')
      }
      if (bytesRead === 0) break
      readTotal += bytesRead
      if (readTotal > expectedBytes) throw new ScanFailure('PRIVACY_MEDIA_CHANGED')
      const content = Buffer.concat([tail, chunk.subarray(0, bytesRead)])
      if (needles.some((needle) => needle.length > 0 && content.includes(needle))) return true
      tail = overlap === 0 ? Buffer.alloc(0) : Buffer.from(content.subarray(Math.max(0, content.length - overlap)))
    }
    if (readTotal !== expectedBytes) throw new ScanFailure('PRIVACY_MEDIA_CHANGED')
    return false
  } finally {
    closeSync(descriptor)
  }
}

function isReparsePoint(path: string, entry: ReturnType<typeof lstatSync>): boolean {
  if (entry.isSymbolicLink()) return true
  if (process.platform !== 'win32') return false
  return spawnSync('fsutil.exe', ['reparsepoint', 'query', path], { stdio: 'ignore', windowsHide: true }).status === 0
}

function result(
  rule: { path: string, ruleId: string },
  status: PrivacyScanResult['status'],
  present: boolean,
  passed: boolean | null,
  errorCode?: string
): PrivacyScanResult {
  return { status, present, passed, path: rule.path, ruleId: rule.ruleId, ...(errorCode ? { errorCode } : {}) }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function scanErrorCode(error: unknown): string {
  return error instanceof ScanFailure ? error.code : 'PRIVACY_MEDIA_IO_FAILED'
}

class ScanFailure extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}
