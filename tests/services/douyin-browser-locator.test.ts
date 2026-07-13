import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }))

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process') & { default: typeof import('node:child_process') }>()
  return {
    ...original,
    default: { ...original.default, execFileSync },
    execFileSync
  }
})

import { findSystemBrowser } from '../../src/services/douyin/browser-locator'

const env = {
  LOCALAPPDATA: 'C:\\Local',
  PROGRAMFILES: 'C:\\Program Files',
  'PROGRAMFILES(X86)': 'C:\\Program Files (x86)'
}

describe('findSystemBrowser', () => {
  beforeEach(() => {
    execFileSync.mockReset()
    execFileSync.mockImplementation(() => {
      throw new Error('registry key not found')
    })
  })

  it('prefers Chrome when Chrome and Edge are installed', () => {
    const exists = vi.fn((candidate: string) =>
      candidate.endsWith('chrome.exe') || candidate.endsWith('msedge.exe')
    )
    const readAppPath = vi.fn(() => null)

    expect(findSystemBrowser({ env, exists, readAppPath })).toEqual({
      kind: 'chrome',
      executablePath: 'C:\\Local\\Google\\Chrome\\Application\\chrome.exe'
    })
    expect(readAppPath).not.toHaveBeenCalled()
    expect(exists).toHaveBeenCalledTimes(1)
  })

  it('uses Edge when Chrome is unavailable', () => {
    const exists = vi.fn((candidate: string) => candidate.endsWith('msedge.exe'))

    expect(findSystemBrowser({ env, exists, readAppPath: () => null })).toEqual({
      kind: 'edge',
      executablePath: 'C:\\Local\\Microsoft\\Edge\\Application\\msedge.exe'
    })
  })

  it('returns null when neither supported browser exists', () => {
    expect(findSystemBrowser({ env: {}, exists: () => false, readAppPath: () => null })).toBeNull()
  })

  it('falls back to a valid App Paths registry value', () => {
    const registryPath = 'C:\\Browsers\\Chrome\\chrome.exe'
    execFileSync.mockReturnValue(
      `HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe\r\n    (Default)    REG_SZ    "${registryPath}"\r\n`
    )

    expect(findSystemBrowser({ env: {}, exists: (candidate) => candidate === registryPath })).toEqual({
      kind: 'chrome',
      executablePath: registryPath
    })
    expect(execFileSync).toHaveBeenCalledWith(
      'reg.exe',
      ['query', 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe', '/ve'],
      expect.objectContaining({ encoding: 'utf8', shell: false })
    )
  })

  it.each([
    ['', 'empty output'],
    ['registry output without a value', 'malformed output'],
    ['    (Default)    REG_SZ    relative\\chrome.exe', 'relative executable'],
    ['    (Default)    REG_SZ    "C:\\Browsers\\chrome.exe" --remote-debugging-port=1', 'quoted path with arguments'],
    ['    (Default)    REG_SZ    C:\\Browsers\\chrome.exe --remote-debugging-port=1', 'unquoted path with arguments'],
    ['    (Default)    REG_SZ    "C:\\Browsers\\chrome.exe\" & calc.exe"', 'embedded malicious quote']
  ])('ignores %s (%s)', (output) => {
    execFileSync.mockReturnValue(output)

    expect(findSystemBrowser({ env: {}, exists: () => true })).toBeNull()
  })

  it('normalizes a registry value containing only a quoted absolute executable path', () => {
    execFileSync.mockReturnValue(
      '    (Default)    REG_SZ    "C:/Browsers/Chrome/../Chrome/chrome.exe"'
    )

    expect(findSystemBrowser({
      env: {},
      exists: (candidate) => candidate === 'C:\\Browsers\\Chrome\\chrome.exe'
    })).toEqual({
      kind: 'chrome',
      executablePath: 'C:\\Browsers\\Chrome\\chrome.exe'
    })
  })

  it('handles missing environment variables without creating relative candidates', () => {
    const exists = vi.fn(() => false)

    expect(findSystemBrowser({ env: {}, exists, readAppPath: () => null })).toBeNull()
    expect(exists).not.toHaveBeenCalled()
  })

  it('normalizes and deduplicates candidates before checking whether they are files', () => {
    const exists = vi.fn(() => false)
    const duplicateRootEnv = {
      LOCALAPPDATA: 'C:/Same/Root',
      PROGRAMFILES: 'C:\\Same\\Root\\.',
      'PROGRAMFILES(X86)': 'c:\\same\\root'
    }

    expect(findSystemBrowser({
      env: duplicateRootEnv,
      exists,
      readAppPath: (name) => `C:\\Same\\Root\\${name === 'chrome.exe' ? 'Google\\Chrome' : 'Microsoft\\Edge'}\\Application\\${name}`
    })).toBeNull()

    expect(exists.mock.calls.map(([candidate]) => candidate)).toEqual([
      'C:\\Same\\Root\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Same\\Root\\Microsoft\\Edge\\Application\\msedge.exe'
    ])
  })

  it('ignores registry failures and continues to Edge', () => {
    const edgePath = 'C:\\Edge\\msedge.exe'
    execFileSync
      .mockImplementationOnce(() => { throw new Error('missing Chrome key') })
      .mockImplementationOnce(() => { throw new Error('missing Chrome key') })
      .mockReturnValueOnce(`    (Default)    REG_SZ    ${edgePath}`)

    expect(findSystemBrowser({ env: {}, exists: (candidate) => candidate === edgePath })).toEqual({
      kind: 'edge',
      executablePath: edgePath
    })
  })
})
