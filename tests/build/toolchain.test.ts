import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const contractPath = resolve('resources/build-toolchain.json')
const ffmpegManifestPath = resolve('resources/ffmpeg-manifest.json')
const verifierPath = resolve('scripts/verify-toolchain.mjs')
const packagePath = resolve('package.json')

const expectedActual = {
  platform: 'win32',
  arch: 'x64',
  node: '24.14.1',
  npm: '11.12.1',
  python: '3.12.10',
  visualStudio: '17.14.37301.10',
  msvc: '14.44.35207',
  windowsSdk: '10.0.26100.0'
}

async function loadContractAndVerifier() {
  expect(existsSync(contractPath), 'tracked toolchain contract is required').toBe(true)
  expect(existsSync(verifierPath), 'dependency-free toolchain verifier is required').toBe(true)
  const contract = JSON.parse(await readFile(contractPath, 'utf8'))
  const verifier = await import(pathToFileURL(verifierPath).href)
  return { contract, verifier }
}

describe('pinned build toolchain', () => {
  it('records every host and locked dependency version needed by the clean build', async () => {
    const { contract } = await loadContractAndVerifier()

    expect(contract).toMatchObject({
      schemaVersion: 1,
      platform: 'win32',
      arch: 'x64',
      node: '24.14.1',
      npm: '11.12.1',
      python: '3.12.10',
      visualStudio: '17.14.37301.10',
      msvc: '14.44.35207',
      windowsSdk: '10.0.26100.0',
      lockedPackages: {
        electron: '43.1.0',
        'node-gyp': '12.4.0',
        '@electron/rebuild': '4.2.0'
      },
      gitleaks: {
        version: '8.30.0',
        url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.0/gitleaks_8.30.0_windows_x64.zip',
        size: 8519574,
        sha256: '54fe94f644b832dd08e8c3a5915efb3bfa862386d59fb27ca0792cb687a83573',
        executable: {
          path: 'gitleaks.exe',
          size: 22689792,
          sha256: '9d08e3f5cfb35a98f230b97bcda24f8d3fc66363c91868ffc98dac0afebdcb72'
        }
      },
      pipTools: {
        version: '7.6.0',
        url: 'https://files.pythonhosted.org/packages/60/2f/5f434153d2bf85ae8f85826228707e694276b9e73d6d8040433a03ceeea9/pip_tools-7.6.0-py3-none-any.whl',
        size: 74337,
        sha256: '4bd99155b6d8de358a214b0865e1a2855a453570c1a83d40f7b564870b8657be',
        wheel: 'pip_tools-7.6.0-py3-none-any.whl'
      }
    })
  })

  it('pins the official Gitleaks artifact exactly and rejects malformed values', async () => {
    const { contract, verifier } = await loadContractAndVerifier()

    expect(verifier.verifyGitleaksContract(contract.gitleaks)).toEqual(contract.gitleaks)
    expect(() => verifier.verifyGitleaksContract({ ...contract.gitleaks, version: '8.29.0' }))
      .toThrow('TOOLCHAIN_GITLEAKS_CONTRACT_INVALID')
    expect(() => verifier.verifyGitleaksContract({ ...contract.gitleaks, sha256: 'not-a-sha256' }))
      .toThrow('TOOLCHAIN_GITLEAKS_CONTRACT_INVALID')
    expect(() => verifier.verifyGitleaksContract({
      ...contract.gitleaks,
      executable: { ...contract.gitleaks.executable, size: 1 }
    })).toThrow('TOOLCHAIN_GITLEAKS_CONTRACT_INVALID')
  })

  it('pins the official pip-tools wheel used to generate Python locks', async () => {
    const { contract, verifier } = await loadContractAndVerifier()

    expect(verifier.verifyPipToolsContract(contract.pipTools)).toEqual(contract.pipTools)
    expect(() => verifier.verifyPipToolsContract({ ...contract.pipTools, size: 1 }))
      .toThrow('TOOLCHAIN_PIP_TOOLS_CONTRACT_INVALID')
  })

  it('exposes the stable public-secret scanner entry point', async () => {
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))

    expect(packageJson.scripts['verify:public-secrets'])
      .toBe('powershell -NoProfile -ExecutionPolicy Bypass -File scripts/scan-public-secrets.ps1')
  })

  it('pins the official immutable FFmpeg Windows asset and redistribution metadata', async () => {
    const ffmpeg = JSON.parse(await readFile(ffmpegManifestPath, 'utf8'))

    expect(ffmpeg).toMatchObject({
      package: { name: 'ffmpeg-static', version: '5.3.0' },
      release: { tag: 'b6.1.1', executableBaseName: 'ffmpeg' },
      platform: 'win32',
      arch: 'x64',
      sourceBaseUrl: 'https://github.com/eugeneware/ffmpeg-static/releases/download',
      license: { spdx: 'GPL-3.0-or-later' }
    })
    for (const value of [ffmpeg.asset.compressed, ffmpeg.asset.decompressed, ffmpeg.readme, ffmpeg.license]) {
      expect(value.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(value.size).toBeGreaterThan(0)
      expect(value.url).toContain('/b6.1.1/')
    }
  })

  it('accepts an exact host snapshot and exact package-lock versions', async () => {
    const { contract, verifier } = await loadContractAndVerifier()
    const lockedPackages = contract.lockedPackages

    expect(verifier.verifyToolchainSnapshot({ contract, actual: expectedActual, lockedPackages }))
      .toEqual({ ...expectedActual, lockedPackages })
  })

  it.each([
    ['node', '24.14.0', 'TOOLCHAIN_NODE_MISMATCH'],
    ['npm', '11.12.0', 'TOOLCHAIN_NPM_MISMATCH'],
    ['python', '3.12.9', 'TOOLCHAIN_PYTHON_MISMATCH'],
    ['visualStudio', '17.14.0', 'TOOLCHAIN_VISUAL_STUDIO_MISMATCH'],
    ['msvc', '14.43.0', 'TOOLCHAIN_MSVC_MISMATCH'],
    ['windowsSdk', '10.0.22621.0', 'TOOLCHAIN_WINDOWS_SDK_MISMATCH']
  ])('fails fast when %s differs', async (field, value, code) => {
    const { contract, verifier } = await loadContractAndVerifier()

    expect(() => verifier.verifyToolchainSnapshot({
      contract,
      actual: { ...expectedActual, [field]: value },
      lockedPackages: contract.lockedPackages
    })).toThrow(code)
  })

  it('rejects a lockfile package version mismatch', async () => {
    const { contract, verifier } = await loadContractAndVerifier()

    expect(() => verifier.verifyToolchainSnapshot({
      contract,
      actual: expectedActual,
      lockedPackages: { ...contract.lockedPackages, electron: '43.0.0' }
    })).toThrow('TOOLCHAIN_LOCKED_PACKAGE_MISMATCH:electron')
  })
})
