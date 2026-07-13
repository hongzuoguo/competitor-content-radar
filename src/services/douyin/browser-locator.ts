import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { win32 as path } from 'node:path'

export type SystemBrowserKind = 'chrome' | 'edge'

export interface SystemBrowserInstallation {
  kind: SystemBrowserKind
  executablePath: string
}

export interface BrowserLocatorDependencies {
  env: NodeJS.ProcessEnv
  exists(path: string): boolean
  readAppPaths(executableName: 'chrome.exe' | 'msedge.exe'): string[]
}

type BrowserDefinition = {
  kind: SystemBrowserKind
  executableName: 'chrome.exe' | 'msedge.exe'
  relativePath: string
}

const BROWSERS: BrowserDefinition[] = [
  {
    kind: 'chrome',
    executableName: 'chrome.exe',
    relativePath: 'Google\\Chrome\\Application\\chrome.exe'
  },
  {
    kind: 'edge',
    executableName: 'msedge.exe',
    relativePath: 'Microsoft\\Edge\\Application\\msedge.exe'
  }
]

const defaultDependencies: BrowserLocatorDependencies = {
  env: process.env,
  exists(candidate: string): boolean {
    try {
      return statSync(candidate).isFile()
    } catch {
      return false
    }
  },
  readAppPaths
}

export function findSystemBrowser(
  dependencies: Partial<BrowserLocatorDependencies> = {}
): SystemBrowserInstallation | null {
  const resolved = { ...defaultDependencies, ...dependencies }

  for (const browser of BROWSERS) {
    const candidates = browserCandidates(browser, resolved)
    for (const executablePath of candidates) {
      if (resolved.exists(executablePath)) return { kind: browser.kind, executablePath }
    }
  }

  return null
}

function* browserCandidates(
  browser: BrowserDefinition,
  dependencies: BrowserLocatorDependencies
): Generator<string> {
  const seen = new Set<string>()
  const environmentCandidates = [
    environmentCandidate(dependencies.env.LOCALAPPDATA, browser.relativePath),
    environmentCandidate(dependencies.env.PROGRAMFILES, browser.relativePath),
    environmentCandidate(dependencies.env['PROGRAMFILES(X86)'], browser.relativePath)
  ]

  for (const candidate of environmentCandidates) {
    const executablePath = normalizeExecutableCandidate(candidate, browser.executableName)
    if (!executablePath) continue
    const key = executablePath.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    yield executablePath
  }

  for (const candidate of dependencies.readAppPaths(browser.executableName)) {
    const registryPath = normalizeExecutableCandidate(candidate, browser.executableName)
    if (!registryPath) continue
    const key = registryPath.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    yield registryPath
  }
}

function environmentCandidate(root: string | undefined, relativePath: string): string | null {
  if (!root?.trim()) return null
  return path.join(root, relativePath)
}

function readAppPaths(executableName: 'chrome.exe' | 'msedge.exe'): string[] {
  const candidates: string[] = []

  for (const hive of ['HKCU', 'HKLM']) {
    try {
      const output = execFileSync(
        'reg.exe',
        ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`, '/ve'],
        { encoding: 'utf8', shell: false, windowsHide: true }
      )
      const candidate = parseRegistryValue(output)
      const normalized = normalizeExecutableCandidate(candidate, executableName)
      if (normalized) candidates.push(normalized)
    } catch {
      // A missing or unreadable registry key only means this installation source is unavailable.
    }
  }

  return candidates
}

function parseRegistryValue(output: string): string | null {
  const match = output.match(/^\s*[^\r\n]*?\s+REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/im)
  if (!match) return null
  const value = match[1].trim()
  if (!value.startsWith('"')) return value.includes('"') ? null : value
  const quoted = value.match(/^"([^"]+)"$/)
  return quoted?.[1] ?? null
}

function normalizeExecutableCandidate(
  candidate: string | null,
  executableName: 'chrome.exe' | 'msedge.exe'
): string | null {
  if (!candidate) return null
  const trimmed = candidate.trim()
  if (!path.isAbsolute(trimmed) || path.extname(trimmed).toLowerCase() !== '.exe') return null
  const normalized = path.normalize(trimmed)
  return path.basename(normalized).toLowerCase() === executableName ? normalized : null
}
