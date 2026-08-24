import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const cleanTestScript = resolve('scripts/build-clean-test.ps1')
const directoryLockScript = resolve('scripts/hold-directory-lock.ps1')
const localApplicationData = process.env.LOCALAPPDATA

if (!localApplicationData) {
  throw new Error('LOCALAPPDATA_MISSING')
}

const hitMuseLocalRoot = join(localApplicationData, 'HitMuse')
const defaultBuildRoot = join(hitMuseLocalRoot, 'release-work', 'build')
const defaultTestRoot = join(hitMuseLocalRoot, 'release-work', 'test')

function validateCleanTestContext(buildRoot: string, testRoot = defaultTestRoot) {
  return execFileAsync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', cleanTestScript,
    '-Commit', 'a'.repeat(40),
    '-CanonicalRepo', process.cwd(),
    '-BuildRoot', buildRoot,
    '-TestRoot', testRoot,
    '-ValidateOnly',
  ], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true })
}

async function runNativeStepValidation(buildRoot: string, exitCode: 0 | 23) {
  return execFileAsync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', cleanTestScript,
    '-Commit', 'a'.repeat(40),
    '-CanonicalRepo', process.cwd(),
    '-BuildRoot', buildRoot,
    '-TestRoot', defaultTestRoot,
    '-ValidateNativeStep',
    '-ValidateNativeExitCode', String(exitCode),
  ], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true })
}

async function readNativeStepValidationLog(buildRoot: string) {
  const sessionsRoot = join(buildRoot, 'sessions')
  const sessions = (await readdir(sessionsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory())
  expect(sessions).toHaveLength(1)
  return readFileSync(join(sessionsRoot, sessions[0].name, 'logs', 'native-step-validation.log'), 'utf8')
}

async function readSingleBuildManifest(buildRoot: string) {
  const sessions = await readdir(join(buildRoot, 'sessions'), { withFileTypes: true })
  const sessionDirectories = sessions.filter((entry) => entry.isDirectory())
  expect(sessionDirectories).toHaveLength(1)
  return JSON.parse(readFileSync(join(buildRoot, 'sessions', sessionDirectories[0].name, 'build-manifest.json'), 'utf8'))
}

describe('GitHub release configuration', () => {
  it('derives local release roots without author-specific paths', () => {
    const cleanTest = readFileSync(cleanTestScript, 'utf8')
    const directoryLock = readFileSync(directoryLockScript, 'utf8')

    expect(cleanTest).toContain("[Environment]::GetFolderPath('LocalApplicationData')")
    expect(cleanTest).not.toMatch(/[EC]:\\\\(?:10500|Users\\\\10500)/i)
    expect(directoryLock).not.toMatch(/[EC]:\\\\(?:10500|Users\\\\10500)/i)
  })

  it('documents public development, immutable resources, and the same-repository release boundary', () => {
    const contributing = readFileSync('CONTRIBUTING.md', 'utf8')
    const readme = readFileSync('README.md', 'utf8')
    const operations = [
      'docs/operations/README.md',
      'docs/operations/electron-preview.md',
      'docs/operations/repository-completeness.md',
      'docs/operations/environment-and-release-policy.md',
      'docs/operations/build-and-clean-test.md'
    ].map((path) => readFileSync(path, 'utf8')).join('\n')
    const documentation = `${contributing}\n${readme}\n${operations}`

    expect(contributing).toContain('py -3.12 -m venv engine\\scrapling\\.venv')
    expect(contributing).toContain('engine\\scrapling\\.venv\\Scripts\\python.exe -m pip install --require-hashes -r engine\\scrapling\\requirements.lock.txt')
    expect(contributing).toContain('npm run setup:scrapling-dev')
    expect(contributing).toContain('npm test')
    expect(contributing).toContain('npm run typecheck')
    expect(contributing).toContain('unittest discover -s engine/scrapling/tests')
    expect(readme).toContain('Windows 10 或 Windows 11，64 位')
    expect(readme).toContain('Chrome 或 Edge')
    expect(readme).toContain('同一公开 GitHub 仓库的 Releases')
    expect(readme).toContain('com.hitmuse.desktop')
    expect(readme).toContain('userData')
    expect(readme).toContain('SHA-256')
    expect(readme).toContain('SmartScreen')
    expect(readme).toContain('safeStorage')
    expect(readme).toContain('不提供计费或付费墙')
    expect(operations).toContain('generated public Scrapling')
    expect(operations).toContain('immutable Hugging Face revision')
    expect(operations).toContain('ffmpeg manifest')
    expect(operations).toContain('public candidate')
    expect(operations).toContain('Gitleaks')
    expect(operations).toContain('reviewed visual JSON')
    expect(operations).toContain('v<package.version>')
    expect(operations).toContain('npm run release:local')
    expect(operations).toContain('does not publish')
    expect(operations).toContain('verifier-excluded internal or local records')
    expect(operations).toContain('Only a candidate that passes public candidate and privacy gates is publishable')
    expect(readFileSync('docs/operations/README.md', 'utf8')).toContain('electron-preview.md')
    expect(operations).toContain('<external-preview-root>')
    expect(operations).toContain('$previewRoot =')
    expect(operations).toContain('own real `node_modules`')
    expect(operations).toContain('outside `<repo-root>`, every checkout, and every registered Git worktree')
    expect(operations).toContain('ordinary non-reparse directory')
    expect(documentation).not.toMatch(/HITMUSE_RESOURCE_GITHUB_TOKEN|RELEASES_REPOSITORY_TOKEN|competitor-content-radar-releases|authenticated private Scrapling|private tag\/asset|gh auth/i)
    expect(documentation).not.toMatch(/E:\\10500|C:\\Users\\10500/i)
  })

  it('ships the public 1.1.0 release version', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      version: string
      dependencies: Record<string, string>
    }
    const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      version: string
      packages: Record<string, { version?: string, dependencies?: Record<string, string> }>
    }
    expect(packageJson.version).toBe('1.1.0')
    expect(packageLock.version).toBe('1.1.0')
    expect(packageLock.packages['']?.version).toBe('1.1.0')
    expect(packageJson.dependencies['ffmpeg-static']).toBe('5.3.0')
    expect(packageLock.packages['']?.dependencies?.['ffmpeg-static']).toBe('5.3.0')
  })

  it('uses same-repository updater metadata while leaving publication to the verified publisher', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>
      build: { publish?: Array<Record<string, string>> }
    }
    expect(packageJson.build.publish).toEqual([{
      provider: 'github', owner: 'hongzuoguo', repo: 'competitor-content-radar', channel: 'latest', releaseType: 'release'
    }])
    expect(JSON.stringify(packageJson.build.publish)).not.toContain('competitor-content-radar-releases')
    expect((packageJson.build as { win?: { artifactName?: string } }).win?.artifactName)
      .toBe('competitor-content-radar-setup-${version}.${ext}')
    expect((packageJson.build as { npmRebuild?: boolean }).npmRebuild).toBe(false)
    expect(readFileSync('scripts/verify-packaged-app.mjs', 'utf8')).toContain('release/win-unpacked/resources/app-update.yml')
  })

  it('provides pure non-publishing package commands and one local release entry', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['verify:build-context']).toBe('node scripts/verify-build-context.mjs')
    expect(packageJson.scripts['verify:public-candidate']).toBe('node scripts/verify-public-candidate.mjs')
    expect(packageJson.scripts['clean-test']).toBe('powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-clean-test.ps1')
    expect(packageJson.scripts['release:local']).toBe('powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-clean-test.ps1')
    expect(packageJson.scripts.postinstall).toBe('node scripts/install-native-deps.mjs')
    expect(packageJson.scripts['package:dir']).toBe('electron-vite build && electron-builder --win dir --x64 --publish never')
    expect(packageJson.scripts['package:installer']).toBe('electron-vite build --mode release && electron-builder --win nsis --x64 --publish never')
    expect(packageJson.scripts['package:dir']).not.toContain('npm ci')
    expect(packageJson.scripts['package:installer']).not.toContain('npm ci')
  })

  it('does not track environment files or unignore them', () => {
    const ignoreRules = readFileSync('.gitignore', 'utf8')

    expect(existsSync('.env.example')).toBe(false)
    expect(existsSync('.env.release')).toBe(false)
    expect(ignoreRules).toContain('.env')
    expect(ignoreRules).toContain('.env.*')
    expect(ignoreRules).not.toContain('!.env.example')
    expect(ignoreRules).not.toContain('!.env.release')
  })

  it('verifies the canonical Node source before creating an Electron packaging worktree', () => {
    const script = readFileSync('scripts/build-clean-test.ps1', 'utf8')

    const worktreeAdd = script.indexOf("-Name 'git-worktree-add'")
    expect(script.indexOf("-Name 'verify-toolchain-before-tests'")).toBeLessThan(worktreeAdd)
    expect(script.indexOf("-Name 'verify-build-context-before-tests'")).toBeLessThan(worktreeAdd)
    expect(script.indexOf("-Name 'verify-node-runtime-before-tests'")).toBeLessThan(worktreeAdd)
    expect(script.indexOf("-Name 'npm-test-node'")).toBeLessThan(worktreeAdd)
    expect(script.indexOf("-Name 'typecheck-node'")).toBeLessThan(worktreeAdd)
    expect(script.indexOf("-Name 'verify-build-context-after-tests'")).toBeLessThan(worktreeAdd)
    expect(script.indexOf('Invoke-ElectronNpmCi -WorkingDirectory $buildWorktree')).toBeGreaterThan(worktreeAdd)
    expect(script.indexOf("-Name 'verify-toolchain-before-install'")).toBeGreaterThan(worktreeAdd)
    expect(script.indexOf("-Name 'verify-toolchain-before-install'"))
      .toBeLessThan(script.indexOf('Invoke-ElectronNpmCi -WorkingDirectory $buildWorktree'))
    expect(script.indexOf('Invoke-ElectronRuntimeProbe -WorkingDirectory $buildWorktree'))
      .toBeGreaterThan(script.indexOf('Invoke-ElectronNpmCi -WorkingDirectory $buildWorktree'))
    expect(script.match(/-Name 'npm-ci'/g) ?? []).toHaveLength(1)
    expect(script.match(/-Name 'npm-test-node'/g) ?? []).toHaveLength(1)
    expect(script).toContain("-Name 'npm-test-node' -FilePath 'npm.cmd' -ArgumentList @('test', '--', '--exclude', 'tests/services/model-source-packaged.integration.test.ts') -WorkingDirectory $canonicalRepo")
    expect(script).not.toContain("-Name 'rebuild-node'")
    expect(script).not.toContain("-Name 'rebuild-electron'")
  })

  it('builds the generated Scrapling resource from tracked source in the formal worktree', () => {
    const script = readFileSync('scripts/build-clean-test.ps1', 'utf8')

    expect(script).toContain("-Name 'prepare-scrapling-resource' -FilePath 'npm.cmd' -ArgumentList @('run', 'build:scrapling') -WorkingDirectory $buildWorktree")
    expect(script).not.toContain("'prepare:scrapling'")
  })

  it('provisions and removes the Scrapling build venv only in the formal worktree', () => {
    const script = readFileSync('scripts/build-clean-test.ps1', 'utf8')

    const electronRuntime = script.indexOf('Invoke-ElectronRuntimeProbe -WorkingDirectory $buildWorktree')
    const setup = script.indexOf("-Name 'setup-scrapling-build-environment' -FilePath 'npm.cmd' -ArgumentList @('run', 'setup:scrapling-dev') -WorkingDirectory $buildWorktree")
    const build = script.indexOf("-Name 'prepare-scrapling-resource' -FilePath 'npm.cmd' -ArgumentList @('run', 'build:scrapling') -WorkingDirectory $buildWorktree")

    expect(setup).toBeGreaterThan(electronRuntime)
    expect(setup).toBeLessThan(build)
    expect(script).toContain("'engine\\scrapling\\.venv'")
    expect(script).not.toContain("Remove-Item -LiteralPath (Join-Path $buildWorktree 'engine\\scrapling')")
  })

  it('builds both public user guides inside the disposable formal environment before packaging', () => {
    const script = readFileSync('scripts/build-clean-test.ps1', 'utf8')
    const installGuideDependency = script.indexOf("-Name 'install-user-guide-dependency'")
    const buildGuide = script.indexOf("-Name 'build-user-guide'")
    const packageInstaller = script.indexOf("-Name 'package-installer'")

    expect(script).toContain("$scraplingPython = Join-Path $buildWorktree 'engine\\scrapling\\.venv\\Scripts\\python.exe'")
    expect(script).toContain("-Name 'install-user-guide-dependency' -FilePath $scraplingPython -ArgumentList @('-m', 'pip', 'install', 'python-docx==1.2.0') -WorkingDirectory $buildWorktree")
    expect(script).toContain("-Name 'build-user-guide' -FilePath $scraplingPython -ArgumentList @('scripts/build-user-guide.py', '--output-directory', 'release/guides') -WorkingDirectory $buildWorktree")
    expect(installGuideDependency).toBeGreaterThan(script.indexOf("-Name 'verify-release-dependencies'"))
    expect(buildGuide).toBeGreaterThan(installGuideDependency)
    expect(buildGuide).toBeLessThan(packageInstaller)
  })

  it('runs packaged checks only after unpacked output and copies only after every verification', () => {
    const script = readFileSync('scripts/build-clean-test.ps1', 'utf8')

    const packageInstaller = script.indexOf("-Name 'package-installer'")
    expect(script).toContain("-Name 'package-installer' -FilePath 'npm.cmd' -ArgumentList @('run', 'package:installer')")
    const packagedModel = script.indexOf("-Name 'packaged-model-integration'")
    const offlineModel = script.indexOf("-Name 'offline-model-package'")
    const smoke = script.indexOf("-Name 'verify-packaged-app'")
    const sourceRecheck = script.indexOf("-Name 'verify-build-context-after-packaging'")
    const finalCopy = script.lastIndexOf('Publish-VerifiedArtifacts -TestStaging')

    expect(packageInstaller).toBeGreaterThan(script.indexOf('Invoke-ElectronRuntimeProbe -WorkingDirectory $buildWorktree'))
    expect(packagedModel).toBeGreaterThan(packageInstaller)
    expect(offlineModel).toBeGreaterThan(packageInstaller)
    expect(smoke).toBeGreaterThan(offlineModel)
    expect(sourceRecheck).toBeGreaterThan(smoke)
    expect(finalCopy).toBeGreaterThan(sourceRecheck)
  })

  it('wires the formal smoke deny list, public evidence, and privacy gates before promotion', () => {
    const script = readFileSync('scripts/build-clean-test.ps1', 'utf8')

    expect(script).toContain("$packageSmokeDenyHosts = Join-Path $packageSmokeRoot 'deny-hosts.json'")
    expect(script).toContain("[ordered]@{ schemaVersion = 1; hosts = @('github.com', 'api.github.com'")
    expect(script).toContain("'--smoke-user-data-dir', $packageSmokeUserData, '--smoke-deny-hosts-file', $packageSmokeDenyHosts, '--smoke-test-root', $testRoot")

    expect(script).toContain("$publicCandidateRoot = Join-Path $privacyRoot 'candidate'")
    expect(script).toContain("$privacyRepositoryRoot = Join-Path $privacyRoot 'repository'")
    expect(script).toContain("$privacyReleaseRoot = Join-Path $privacyRoot 'release'")
    expect(script).toContain("$privacyReportRoot = Join-Path $privacyRoot 'report'")
    expect(script).toContain("$privacyToolRoot = Join-Path $privacyRoot 'tools'")
    expect(script).toContain("scripts/verify-public-candidate.mjs', '--candidate', $publicCandidateRoot")
    expect(script).toContain("scripts/scan-public-secrets.ps1', '-CandidateRoot', $publicCandidateRoot, '-RepositoryRoot', $privacyRepositoryRoot, '-ReleaseRoot', $privacyReleaseRoot, '-ReportRoot', $privacyReportRoot, '-ToolRoot', $privacyToolRoot")
    expect(script).toContain("scripts/build-visual-privacy-manifest.mjs', '--candidate-root', $publicCandidateRoot, '--release-root', $privacyReleaseRoot, '--report-path', $visualPrivacyReport")
    expect(script).toContain('VISUAL_PRIVACY_REVIEW_REQUIRED: human review is required; this workflow never auto-passes visual privacy.')

    const evidence = script.indexOf("-Name 'generate-release-evidence'")
    const privacy = script.indexOf("-Name 'verify-public-candidate'")
    const publish = script.lastIndexOf('Publish-VerifiedArtifacts -TestStaging')
    expect(evidence).toBeGreaterThan(script.indexOf("-Name 'verify-packaged-app'"))
    expect(privacy).toBeGreaterThan(evidence)
    expect(publish).toBeGreaterThan(privacy)
    expect(script).toContain('SHA256SUMS.txt')
    expect(script).toContain('THIRD_PARTY_NOTICES.md')
    expect(script).toContain('engine-provenance.json')
    expect(script).toContain('acceptance.log')
  })

  it('uses the complete exact offline smoke deny-host set without blocking Douyin', () => {
    const script = readFileSync('scripts/build-clean-test.ps1', 'utf8')
    const expectedHosts = [
      'github.com',
      'api.github.com',
      'objects.githubusercontent.com',
      'release-assets.githubusercontent.com',
      'huggingface.co',
      'cdn-lfs.huggingface.co',
      'cas-bridge.xethub.hf.co',
      'api.hitmuse.com',
      'hitmuse-beta-d8gbn7x2o2d6b8c2c-1463630014.ap-shanghai.app.tcloudbase.com',
    ]

    const configuredHosts = [...(script.match(/\[ordered\]@\{ schemaVersion = 1; hosts = @\(([^)]*)\)/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((host) => host[1])
    expect(configuredHosts).toEqual(expectedHosts)
    expect(script).not.toContain('douyin.com')
    expect(script).not.toContain('*.github.com')
  })

  it('keeps the app and packaged verifier deny policies exactly aligned', () => {
    const exactHosts = [
      'github.com',
      'api.github.com',
      'objects.githubusercontent.com',
      'release-assets.githubusercontent.com',
      'huggingface.co',
      'cdn-lfs.huggingface.co',
      'cas-bridge.xethub.hf.co',
      'api.hitmuse.com',
      'hitmuse-beta-d8gbn7x2o2d6b8c2c-1463630014.ap-shanghai.app.tcloudbase.com',
    ]
    const extractHosts = (source: string): string[] => {
      const match = source.match(/export const CANONICAL_SMOKE_DENY_HOSTS = \[([\s\S]*?)\] as const|export const CANONICAL_SMOKE_DENY_HOSTS = \[([\s\S]*?)\]/)
      expect(match).not.toBeNull()
      return [...(match?.[1] ?? match?.[2] ?? '').matchAll(/'([^']+)'/g)].map((host) => host[1])
    }

    expect(extractHosts(readFileSync('src/main/smoke-network-policy.ts', 'utf8'))).toEqual(exactHosts)
    expect(extractHosts(readFileSync('scripts/verify-packaged-app.mjs', 'utf8'))).toEqual(exactHosts)
  })

  it('keeps clean-test lifecycle evidence separate while flattening public evidence in the release root', () => {
    const script = readFileSync('scripts/build-clean-test.ps1', 'utf8')

    expect(script).toContain("$publicEvidenceFiles = @('SHA256SUMS.txt', 'checksums.json', 'build-manifest.json', 'acceptance.log'")
    expect(script).toContain('foreach ($stagingRoot in @($releaseStaging))')
    expect(script).toContain("Join-Path $testStaging 'build-manifest.json'")
    expect(script).toContain("Join-Path $testStaging 'checksums.json'")
    expect(script).toContain("Join-Path $testStaging 'build-summary.log'")
    expect(script).toContain("Join-Path $cleanRoot 'build-manifest.json'")
    expect(script).toContain('STAGED_PUBLIC_EVIDENCE_MISMATCH')
    expect(script).not.toContain("Join-Path $testStaging 'evidence'")
    expect(script).not.toContain("Join-Path $releaseStaging 'evidence'")
  })

  it('uses a self-contained streaming SHA-256 helper for formal evidence', () => {
    const script = readFileSync('scripts/build-clean-test.ps1', 'utf8')

    expect(script).toContain('function Get-Sha256Hex')
    expect(script).toContain('[System.Security.Cryptography.SHA256]::Create()')
    expect(script).toContain('[System.IO.File]::OpenRead($Path)')
    expect(script).toContain('$hash.ComputeHash($stream)')
    expect(script).toContain("[System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()")
    expect(script).not.toContain('Get-FileHash')
  })

  it('requires an exact reviewed external visual manifest before later promotion', () => {
    const script = readFileSync('scripts/build-clean-test.ps1', 'utf8')

    expect(script).toContain('[string]$VisualPrivacyReview')
    expect(script).toContain("$reviewRoot = Join-Path $buildRoot 'reviews'")
    expect(script).toContain('$visualManifestSha256 = Get-Sha256Hex -Path $visualPrivacyReport')
    expect(script).toContain('$visualPrivacyReviewTemplate = Join-Path $reviewRoot "visual-privacy-review-$fullSha-$visualManifestSha256.json"')
    expect(script).toContain('VISUAL_PRIVACY_REVIEW_REQUIRED')
    expect(script).toContain("-Name 'read-visual-privacy-review-binding' -FilePath 'node.exe'")
    expect(script).toContain("-Name 'verify-visual-privacy-review' -FilePath 'node.exe' -ArgumentList @('scripts/verify-visual-privacy-review.mjs', '--manifest', $visualPrivacyReport, '--review', $reviewPath, '--commit', $fullSha, '--review-root', $reviewRoot)")
    expect(script).toContain("throw 'VISUAL_PRIVACY_REVIEW_REQUIRED: inspect and mark the external visual privacy review template before a separate authorized release promotion.'")
    expect(script.indexOf("$reviewRoot = Join-Path $buildRoot 'reviews'"))
      .toBeLessThan(script.indexOf('$visualManifestSha256 = Get-Sha256Hex -Path $visualPrivacyReport'))
    expect(script.indexOf('VISUAL_PRIVACY_REVIEW_REQUIRED')).toBeLessThan(script.lastIndexOf('Publish-VerifiedArtifacts -TestStaging'))
  })

  it('records failures before automatic no-force cleanup in the shared finally path', () => {
    const script = readFileSync('scripts/build-clean-test.ps1', 'utf8')

    expect(script).toContain("'test', '--', '--exclude', 'tests/services/model-source-packaged.integration.test.ts'")
    expect(script).toContain("-FilePath 'npx.cmd' -ArgumentList @('vitest', 'run', 'tests/services/model-source-packaged.integration.test.ts')")
    expect(script).toContain("-FilePath 'npx.cmd' -ArgumentList @('vitest', 'run', 'tests/release/offline-model-package.test.ts')")
    expect(script).toContain("\"--hitmuse-user-data-dir=$userDataDirectory\"")
    expect(script).toContain("status = 'FAILED'")
    expect(script).toContain('failedStage = $currentStage')
    expect(script.indexOf("status = 'FAILED'")).toBeLessThan(script.lastIndexOf('} finally {'))
    expect(script).toContain('Remove-SessionOwnedDirectory')
    expect(script).toContain('$packageSmokeRoot')
    expect(script).toContain("'worktree', 'remove', $WorktreePath")
    expect(script).not.toContain("'worktree', 'remove', '--force'")
  })

  it('writes clean-test checksum artifacts with the archive validation contract', () => {
    const script = readFileSync('scripts/build-clean-test.ps1', 'utf8')

    expect(script).toContain("[ordered]@{ path = 'app/HitMuse.exe'; sha256 =")
    expect(script).toContain("[ordered]@{ path = 'app/resources/app.asar'; sha256 =")
    expect(script).toContain('; bytes = (Get-Item -LiteralPath $sourceExecutable).Length }')
    expect(script).toContain('; bytes = (Get-Item -LiteralPath $sourceAppArchive).Length }')
    expect(script).toContain("generatedAt = (Get-Date).ToUniversalTime().ToString('o')")
    expect(script).toContain('artifacts = $sourceArtifacts')
  })

  it('prepares model and all packaged resources automatically after npm ci', () => {
    const script = readFileSync('scripts/build-clean-test.ps1', 'utf8')
    expect(script).not.toContain('[string]$ModelSource')
    expect(script).not.toContain('SENSEVOICE_MODEL_DIR')
    expect(script).not.toContain('ALLOW_MODEL_DOWNLOAD')
    expect(script).not.toContain('Invoke-ModelPreparationStep')
    expect(script).not.toContain('validate-model-source')
    expect(script).toContain("-Name 'prepare-model-resource' -FilePath 'npm.cmd' -ArgumentList @('run', 'prepare:model')")
    expect(script).toContain("-Name 'verify-resource-completeness' -FilePath 'node.exe' -ArgumentList @('scripts/verify-resource-completeness.mjs', '--result', $resourceVerification)")
    expect(script).toContain('modelFingerprint')
    expect(script).toContain("$manifestState['model'] = $modelFingerprint")
    expect(script).toContain("$manifestState['resources'] = Get-Content -LiteralPath $resourceVerification -Raw -Encoding utf8 | ConvertFrom-Json")
    expect(script).toContain('[long]::TryParse')
    expect(script).not.toContain('$file.size -isnot [long]')
    expect(script.indexOf("-Name 'verify-build-context-before-tests'"))
      .toBeLessThan(script.lastIndexOf("-Name 'prepare-model-resource'"))
    expect(script.indexOf('Invoke-ElectronNpmCi -WorkingDirectory $buildWorktree'))
      .toBeLessThan(script.lastIndexOf("-Name 'prepare-model-resource'"))
    expect(script.indexOf("-Name 'prepare-model-resource'"))
      .toBeLessThan(script.indexOf("-Name 'verify-resource-completeness'"))
    expect(script.indexOf("-Name 'verify-resource-completeness'"))
      .toBeLessThan(script.indexOf("-Name 'package-installer'"))
  })

  it('uses a Windows PowerShell 5.1-compatible append pipeline for native-step logs', async () => {
    const script = readFileSync('scripts/build-clean-test.ps1', 'utf8')
    expect(script).toContain('Add-Content -LiteralPath $logPath -Value $outputLine -Encoding utf8')
    expect(script).not.toContain('Tee-Object -LiteralPath $logPath -Append')

    const fixture = await mkdtemp(join(tmpdir(), 'native-step-log-'))
    const logFile = join(fixture, 'native-step.log')
    await writeFile(logFile, 'STEP_START\r\n', 'utf8')
    try {
      const command = [
        '$logFile = $env:HITMUSE_NATIVE_STEP_TEST_LOG',
        "& cmd.exe /d /c 'echo CHILD_OUTPUT' 2>&1 | ForEach-Object { $outputLine = $_.ToString(); Add-Content -LiteralPath $logFile -Value $outputLine -Encoding utf8; Write-Output $_ }",
        'exit $LASTEXITCODE',
      ].join('; ')
      const result = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
        cwd: process.cwd(),
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, HITMUSE_NATIVE_STEP_TEST_LOG: logFile },
      })

      expect(result.stdout).toContain('CHILD_OUTPUT')
      expect(readFileSync(logFile, 'utf8')).toContain('STEP_START')
      expect(readFileSync(logFile, 'utf8')).toContain('CHILD_OUTPUT')
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  })

  it('removes verified session-owned trees through a Windows extended-length path', () => {
    const script = readFileSync('scripts/build-clean-test.ps1', 'utf8')

    expect(script).toContain("return '\\\\?\\UNC\\' + $absolute.TrimStart('\\')")
    expect(script).toContain("return '\\\\?\\' + $absolute")
    expect(script).toContain('[System.IO.Directory]::Delete((ConvertTo-ExtendedLengthPath -Path $Path), $true)')
    expect(script).not.toContain('Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop')
  })

  it('validates a custom direct smoke root for the directory lock helper', async () => {
    const approvedRoot = await mkdtemp(join(tmpdir(), 'lock-approved-root-'))
    const smokeRoot = join(approvedRoot, 'smoke-lock')
    const escapeRoot = await mkdtemp(join(tmpdir(), 'smoke-lock-escape-'))
    await mkdir(smokeRoot)
    try {
      await expect(execFileAsync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', directoryLockScript,
        '-Directory', smokeRoot, '-TestRoot', approvedRoot, '-ValidateOnly',
      ], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true })).resolves.toMatchObject({
        stdout: expect.stringContaining('LOCK_VALID'),
      })
      await expect(execFileAsync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', directoryLockScript,
        '-Directory', escapeRoot, '-TestRoot', approvedRoot, '-ValidateOnly',
      ], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true })).rejects.toMatchObject({
        stderr: expect.stringContaining('LOCK_PATH_NOT_APPROVED'),
      })
    } finally {
      await rm(approvedRoot, { recursive: true, force: true })
      await rm(escapeRoot, { recursive: true, force: true })
    }
  })

  it('passes and releases the approved smoke root when the directory lock cannot become ready', () => {
    const verifier = readFileSync('scripts/verify-packaged-app.mjs', 'utf8')

    expect(verifier).toContain("'-Directory', smokeRoot, '-TestRoot', approvedTestRoot")
    expect(verifier).toContain('await acquireSmokeDirectoryLock(smokeRoot, approvedTestRoot)')
    expect(verifier).toMatch(/async function acquireSmokeDirectoryLock[\s\S]*?catch \(error\) \{\s*await releaseSmokeDirectoryLock\(lock\)\s*throw error/)
  })

  it('treats native stderr with exit code zero as success under Windows PowerShell 5.1', async () => {
    const buildRoot = await mkdtemp(join(tmpdir(), 'native-step-success-'))
    try {
      await expect(runNativeStepValidation(buildRoot, 0)).resolves.toMatchObject({
        stdout: expect.stringContaining('NATIVE_STEP_STDERR'),
      })
      const log = await readNativeStepValidationLog(buildRoot)
      expect(log).toContain('NATIVE_STEP_STDERR')
      expect(log).toContain('STEP_EXIT name=native-step-validation exit=0')
    } finally {
      await rm(buildRoot, { recursive: true, force: true })
    }
  })

  it('fails a native step only from its nonzero exit code under Windows PowerShell 5.1', async () => {
    const buildRoot = await mkdtemp(join(tmpdir(), 'native-step-failure-'))
    try {
      await expect(runNativeStepValidation(buildRoot, 23)).rejects.toBeDefined()
      const log = await readNativeStepValidationLog(buildRoot)
      expect(log).toContain('NATIVE_STEP_STDERR')
      expect(log).toContain('STEP_EXIT name=native-step-validation exit=23')
    } finally {
      await rm(buildRoot, { recursive: true, force: true })
    }
  })

  it('rechecks exact worktree registration in finally even when the added flag is false', () => {
    const script = readFileSync('scripts/build-clean-test.ps1', 'utf8')
    expect(script).toContain('$registeredWorktree = Test-RegisteredWorktree')
    expect(script).toContain('if ($worktreeAdded -or $registeredWorktree)')
    expect(script).toContain('CLEAN_TEST_WORKTREE_CLEANUP_BLOCKED: full commit was not resolved')
    expect(script).toContain('CLEAN_TEST_WORKTREE_CLEANUP_BLOCKED: retained')
    expect(script).not.toContain('worktree-remove-force')
    expect(script.indexOf('$registeredWorktree = Test-RegisteredWorktree'))
      .toBeLessThan(script.indexOf('if ($worktreeAdded -or $registeredWorktree)'))
    expect(script.indexOf('if ($worktreeAdded -or $registeredWorktree)'))
      .toBeLessThan(script.indexOf('Remove-VerifiedWorktree -CanonicalRepository'))
  })

  it('validates only an approved build root and the default test root without creating a worktree', async () => {
    await expect(validateCleanTestContext(join(defaultBuildRoot, 'validate-only'))).resolves.toMatchObject({
      stdout: expect.stringContaining('CLEAN_TEST_VALIDATION_OK')
    })
  })

  it.each([
    ['formal app data', join(process.env.APPDATA!, 'competitor-content-radar'), defaultTestRoot, 'BUILD_ROOT_PATH_PROTECTED'],
    ['existing test environment', defaultTestRoot, defaultTestRoot, 'BUILD_ROOT_PATH_PROTECTED'],
  ])('rejects %s in validation mode', async (_label, buildRoot, testRoot, errorCode) => {
    await expect(validateCleanTestContext(buildRoot, testRoot)).rejects.toMatchObject({
      stderr: expect.stringContaining(errorCode)
    })
  })

  it('rejects a BuildRoot junction in validation mode without creating a worktree', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'build-root-junction-'))
    const target = join(fixture, 'target')
    const junction = join(fixture, 'junction')
    await mkdir(target)
    await symlink(target, junction, 'junction')
    try {
      await expect(validateCleanTestContext(junction)).rejects.toMatchObject({
        stderr: expect.stringContaining('BUILD_ROOT_REPARSE_POINT')
      })
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  })

  it('holds a smoke directory object lock until its stdin closes', async () => {
    await mkdir(defaultTestRoot, { recursive: true })
    const smokeRoot = await mkdtemp(join(defaultTestRoot, 'smoke-lock-test-'))
    const lock = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', directoryLockScript, '-Directory', smokeRoot, '-TestRoot', defaultTestRoot], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let output = ''
    let errors = ''
    lock.stdout.on('data', (chunk) => { output += chunk })
    lock.stderr.on('data', (chunk) => { errors += chunk })
    try {
      await new Promise<void>((resolveReady, rejectReady) => {
        const timer = setTimeout(() => rejectReady(new Error(`LOCK_READY_TIMEOUT: ${output} ${errors}`)), 5_000)
        lock.once('error', rejectReady)
        lock.stdout.on('data', () => {
          if (output.includes('LOCK_READY')) {
            clearTimeout(timer)
            resolveReady()
          }
        })
      })
      await expect(execFileAsync('powershell.exe', ['-NoProfile', '-Command', `Remove-Item -LiteralPath '${smokeRoot}' -Force`], {
        windowsHide: true
      })).rejects.toBeDefined()
    } finally {
      lock.stdin.end()
      if (lock.exitCode === null) {
        await new Promise<void>((resolveExit) => lock.once('exit', () => resolveExit()))
      }
      await rm(smokeRoot, { recursive: true, force: true })
    }
  }, 15_000)

  it('exports packaged-app smoke helpers that use the app user-data flag', async () => {
    const userData = join(defaultTestRoot, 'smoke-abc', 'user-data')
    const denyHosts = join(defaultTestRoot, 'smoke-abc', 'deny-hosts.json')
    const probe = [
      "import { buildSmokeLaunchArguments, parseSmokeArguments } from './scripts/verify-packaged-app.mjs'",
      `const smoke = parseSmokeArguments(['--smoke-user-data-dir', ${JSON.stringify(userData)}, '--smoke-deny-hosts-file', ${JSON.stringify(denyHosts)}, '--smoke-test-root', ${JSON.stringify(defaultTestRoot)}])`,
      "const args = buildSmokeLaunchArguments(smoke.userData, smoke.denyHostsFile, smoke.approvedTestRoot)",
      `if (!args.includes(${JSON.stringify(`--hitmuse-user-data-dir=${userData}`)})) process.exit(2)`,
      "if (args.some((argument) => argument.startsWith('--user-data-dir='))) process.exit(3)",
      `if (!args.includes(${JSON.stringify(`--hitmuse-smoke-deny-hosts-file=${denyHosts}`)})) process.exit(4)`,
      `if (!args.includes(${JSON.stringify(`--hitmuse-smoke-test-root=${defaultTestRoot}`)})) process.exit(5)`,
    ].join('; ')

    await expect(execFileAsync(process.execPath, ['--input-type=module', '--eval', probe], {
      cwd: process.cwd(), encoding: 'utf8', windowsHide: true
    })).resolves.toMatchObject({ stdout: '' })
  })

  it('accepts explicitly supplied isolated output roots in validation mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-clean-test-root-'))
    try {
      await expect(validateCleanTestContext(join(root, 'build'), join(root, 'test'))).resolves.toMatchObject({
        stdout: expect.stringContaining('CLEAN_TEST_VALIDATION_OK')
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts an explicit ordinary CI smoke root and rejects escapes, reparse roots, and the repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hitmuse-ci-smoke-root-'))
    const linkedRoot = `${root}-link`
    const smokeArguments = (approvedRoot: string, userData = join(approvedRoot, 'smoke-ci', 'user-data')) => [
      '--smoke-user-data-dir', userData,
      '--smoke-deny-hosts-file', join(dirname(userData), 'deny-hosts.json'),
      '--smoke-test-root', approvedRoot
    ]
    try {
      await symlink(root, linkedRoot, 'junction')
      const probe = [
        "import { parseSmokeArguments } from './scripts/verify-packaged-app.mjs'",
        `const accepted = parseSmokeArguments(${JSON.stringify(smokeArguments(root))})`,
        `if (accepted.approvedTestRoot !== ${JSON.stringify(root)} || accepted.smokeRoot !== ${JSON.stringify(join(root, 'smoke-ci'))}) process.exit(2)`,
        `for (const input of ${JSON.stringify([smokeArguments(root, join(root, 'nested', 'smoke-ci', 'user-data')), smokeArguments(process.cwd()), smokeArguments(linkedRoot)])}) { try { parseSmokeArguments(input); process.exit(3) } catch (error) { if (!String(error.message).includes('PACKAGED_APP_SMOKE_PATH')) process.exit(4) } }`
      ].join('; ')
      await expect(execFileAsync(process.execPath, ['--input-type=module', '--eval', probe], {
        cwd: process.cwd(), encoding: 'utf8', windowsHide: true
      })).resolves.toMatchObject({ stdout: '' })
    } finally {
      await rm(linkedRoot, { recursive: true, force: true })
      await rm(root, { recursive: true, force: true })
    }
  })

  it('carries the parsed approved smoke root through the packaged-app launch path', () => {
    expect(readFileSync('scripts/verify-packaged-app.mjs', 'utf8'))
      .toContain('buildSmokeLaunchArguments(userData, denyHostsFile, approvedTestRoot)')
  })

  it('accepts only an orchestrator-seeded deny-hosts file in a precreated smoke root', async () => {
    await mkdir(defaultTestRoot, { recursive: true })
    const smokeRoot = await mkdtemp(join(defaultTestRoot, 'smoke-precreated-'))
    const userData = join(smokeRoot, 'user-data')
    const denyHosts = join(smokeRoot, 'deny-hosts.json')
    try {
      const exactPolicy = {
        schemaVersion: 1,
        hosts: ['github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'huggingface.co', 'cdn-lfs.huggingface.co', 'cas-bridge.xethub.hf.co', 'api.hitmuse.com', 'hitmuse-beta-d8gbn7x2o2d6b8c2c-1463630014.ap-shanghai.app.tcloudbase.com']
      }
      await writeFile(denyHosts, JSON.stringify(exactPolicy), 'utf8')
      const smokeArguments = JSON.stringify([
        '--smoke-user-data-dir', userData,
        '--smoke-deny-hosts-file', denyHosts,
        '--smoke-test-root', defaultTestRoot,
      ])
      const probe = [
        "import { assertPrecreatedSmokeRoot, parseSmokeArguments } from './scripts/verify-packaged-app.mjs'",
        `const smoke = parseSmokeArguments(${smokeArguments})`,
        'await assertPrecreatedSmokeRoot(smoke)',
        `await (await import('node:fs/promises')).writeFile(${JSON.stringify(denyHosts)}, JSON.stringify({ schemaVersion: 1, hosts: ['api.github.com'] }))`,
        "try { await assertPrecreatedSmokeRoot(smoke); process.exit(2) } catch (error) { if (!String(error.message).includes('PACKAGED_APP_SMOKE_PRECREATED_INVALID')) process.exit(3) }",
      ].join('; ')

      await expect(execFileAsync(process.execPath, ['--input-type=module', '--eval', probe], {
        cwd: process.cwd(), encoding: 'utf8', windowsHide: true
      })).resolves.toMatchObject({ stdout: '' })
    } finally {
      await rm(smokeRoot, { recursive: true, force: true })
    }
  })

  it('requires the packaged smoke marker to confirm embedded engine and model readiness', async () => {
    const probe = [
      "import { assertSmokeRuntimeReadiness } from './scripts/verify-packaged-app.mjs'",
      "assertSmokeRuntimeReadiness('{\"schemaVersion\":1,\"engine\":\"ready\",\"model\":\"ready\"}')",
      "try { assertSmokeRuntimeReadiness('{\"schemaVersion\":1,\"engine\":\"ready\",\"model\":\"missing\"}'); process.exit(2) } catch (error) { if (!String(error.message).includes('PACKAGED_APP_RUNTIME_READINESS_INVALID')) process.exit(3) }"
    ].join('; ')

    await expect(execFileAsync(process.execPath, ['--input-type=module', '--eval', probe], {
      cwd: process.cwd(), encoding: 'utf8', windowsHide: true
    })).resolves.toMatchObject({ stdout: '' })
  })

  it('rejects a smoke junction and retains no recursive-removal path in the verifier', async () => {
    const userData = join(defaultTestRoot, 'smoke-junction', 'user-data')
    const denyHosts = join(defaultTestRoot, 'smoke-junction', 'deny-hosts.json')
    const probe = [
      "import { assertSmokePathIntegrity, parseSmokeArguments } from './scripts/verify-packaged-app.mjs'",
      `const smoke = parseSmokeArguments(['--smoke-user-data-dir', ${JSON.stringify(userData)}, '--smoke-deny-hosts-file', ${JSON.stringify(denyHosts)}, '--smoke-test-root', ${JSON.stringify(defaultTestRoot)}])`,
      "await assertSmokePathIntegrity(smoke, { lstat: async () => ({ isSymbolicLink: () => true }), realpath: async (value) => value })",
    ].join('; ')
    await expect(execFileAsync(process.execPath, ['--input-type=module', '--eval', probe], {
      cwd: process.cwd(), encoding: 'utf8', windowsHide: true
    })).rejects.toMatchObject({ stderr: expect.stringContaining('PACKAGED_APP_SMOKE_REPARSE_POINT') })

    expect(readFileSync('scripts/verify-packaged-app.mjs', 'utf8')).not.toContain('rm(smokeRoot')
  })

  it('separates tag validation/build evidence from the one same-repository publishing job', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    expect(workflow).toContain("tags: ['v*']")
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow).toContain('Validate exact version tag')
    expect(workflow).toContain('Validate reviewed visual evidence')
    expect(workflow).toContain("npm test -- --exclude tests/services/model-source-packaged.integration.test.ts")
    expect(workflow).toContain('$testTemp = Join-Path $env:SystemDrive "hitmuse-tests-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"')
    expect(workflow).toContain('$env:TEMP = $testTemp')
    expect(workflow).toContain('$env:TMP = $testTemp')
    expect(workflow).toContain("$env:PYTHONUTF8 = '1'")
    expect(workflow).toContain('--maxWorkers 2')
    expect(workflow).toContain('python -m pip install python-docx==1.2.0')
    expect(workflow).toContain('npm run typecheck')
    expect(workflow).toContain('npm run package:installer')
    expect(workflow).toContain('$smokeRoot = Join-Path $env:RUNNER_TEMP')
    expect(workflow).toContain("$visualReportRoot = Join-Path $env:RUNNER_TEMP 'visual-privacy-report'")
    expect(workflow).toContain("$report = Join-Path $visualReportRoot 'visual-privacy.json'")
    expect(workflow).toContain('New-Item -ItemType Directory -Path $candidate, $reviewRoot, $visualReportRoot')
    expect(workflow).toContain('"smoke-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"')
    expect(workflow).toContain('--smoke-user-data-dir $userData --smoke-deny-hosts-file $denyHosts')
    expect(workflow).toContain('--smoke-test-root $env:RUNNER_TEMP')
    expect(workflow).toContain("'github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'huggingface.co', 'cdn-lfs.huggingface.co', 'cas-bridge.xethub.hf.co', 'api.hitmuse.com', 'hitmuse-beta-d8gbn7x2o2d6b8c2c-1463630014.ap-shanghai.app.tcloudbase.com'")
    expect(workflow).toContain('node scripts/publish-github-release.mjs --repository "${{ github.repository }}"')
    expect(workflow).toContain('GITHUB_TOKEN: ${{ github.token }}')
    expect(workflow).toContain('contents: write')
    expect(workflow).toContain('uses: actions/upload-artifact@')
    expect(workflow).toContain('uses: actions/download-artifact@')
    expect(workflow).toContain('$repositoryRoot = $env:GITHUB_WORKSPACE')
    expect(workflow).not.toContain('New-Item -ItemType Directory -Path $candidateRoot, $repositoryRoot')
    expect(workflow).toContain('release/competitor-content-radar-setup-$version.exe')
    expect(workflow).not.toContain('Copy-Item release/*')
    expect(workflow).toContain('uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0')
    expect(workflow).toContain('uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0')
    expect(workflow).toContain('uses: actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065 # v5.6.0')
    expect(workflow).not.toMatch(/HITMUSE_RESOURCE_GITHUB_TOKEN|RELEASES_REPOSITORY_TOKEN|gh auth|softprops|competitor-content-radar-releases/i)
    expect(workflow.match(/contents: write/g)).toHaveLength(1)
    expect(workflow.match(/run: npm ci/g)).toHaveLength(3)
    expect(workflow.match(/runs-on: windows-2022/g)).toHaveLength(4)
    expect(workflow).not.toContain('runs-on: windows-latest')
    const releaseEngine = workflow.slice(workflow.indexOf('\n  engine:'), workflow.indexOf('\n  package:'))
    expect(releaseEngine).toContain('working-directory: engine/scrapling')
    expect(releaseEngine).toContain('run: ./.venv/Scripts/python.exe -m unittest discover -s tests')
    expect(releaseEngine.indexOf('npm install --global npm@11.12.1')).toBeLessThan(releaseEngine.indexOf('npm run verify:toolchain'))
  })

  it('packages only the runtime contract and reserves releases for version tags', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      build: { files: string[] }
    }
    const releaseWorkflow = load(readFileSync('.github/workflows/release.yml', 'utf8')) as {
      on: { push: { tags: string[], branches?: string[] } }
    }
    const ciWorkflow = load(readFileSync('.github/workflows/ci.yml', 'utf8')) as {
      on: { push: { branches: string[], tags?: string[] }, pull_request: { branches: string[] } }
    }

    expect(packageJson.build.files).toEqual([
      'out/**/*',
      'resources/model-manifest.json',
      'package.json',
    ])
    expect(releaseWorkflow.on).toEqual({ push: { tags: ['v*'] } })
    expect(releaseWorkflow.on.push.branches).toBeUndefined()
    expect(ciWorkflow.on.push.branches).toEqual(['main'])
    expect(ciWorkflow.on.push.tags).toBeUndefined()
    expect(ciWorkflow.on.pull_request.branches).toEqual(['main'])
  })

  it('runs ABI-isolated public CI on main and pull requests without release credentials', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    expect(workflow).toContain('pull_request:')
    expect(workflow).toContain('branches: [main]')
    expect(workflow).toContain('npm ci')
    expect(workflow).toContain('npm run verify:toolchain')
    expect(workflow).toContain("npm test -- --exclude tests/services/model-source-packaged.integration.test.ts")
    expect(workflow).toContain('$testTemp = Join-Path $env:SystemDrive "hitmuse-tests-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"')
    expect(workflow).toContain('$env:TEMP = $testTemp')
    expect(workflow).toContain('$env:TMP = $testTemp')
    expect(workflow).toContain("$env:PYTHONUTF8 = '1'")
    expect(workflow).toContain('--maxWorkers 2')
    expect(workflow).toContain('python -m pip install python-docx==1.2.0')
    expect(workflow).toContain('npm run typecheck')
    expect(workflow).toContain('node scripts/verify-public-candidate.mjs')
    expect(workflow).toContain('scripts/scan-public-secrets.ps1')
    expect(workflow).toContain('$repositoryRoot = $env:GITHUB_WORKSPACE')
    expect(workflow).not.toContain('New-Item -ItemType Directory -Path $candidateRoot, $repositoryRoot')
    expect(workflow).toContain("python-version: '3.12.10'")
    expect(workflow).toContain('npm run setup:scrapling-dev')
    expect(workflow).toContain('run: ./.venv/Scripts/python.exe -m unittest discover -s tests')
    expect(workflow).toContain('npm run build:scrapling')
    expect(workflow).toContain('verifyGeneratedScraplingResource')
    expect(workflow).toContain('--publish never')
    expect(workflow.match(/npm install --global npm@11\.12\.1/g)).toHaveLength(2)
    expect(workflow.match(/run: npm ci/g)).toHaveLength(2)
    const ciEngine = workflow.slice(workflow.indexOf('\n  engine:'))
    expect(ciEngine).toContain('working-directory: engine/scrapling')
    expect(ciEngine).toContain('run: ./.venv/Scripts/python.exe -m unittest discover -s tests')
    expect(ciEngine.indexOf('npm install --global npm@11.12.1')).toBeLessThan(ciEngine.indexOf('npm run verify:toolchain'))
    expect(workflow).not.toMatch(/contents: write|HITMUSE_RESOURCE_GITHUB_TOKEN|RELEASES_REPOSITORY_TOKEN|gh auth|competitor-content-radar-releases/i)
    expect(workflow.match(/runs-on: windows-2022/g)).toHaveLength(2)
    expect(workflow).not.toContain('runs-on: windows-latest')
  })

  it('requires a create-only same-commit human review JSON without logging its contents', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    expect(workflow).toContain('HITMUSE_REVIEWED_VISUAL_EVIDENCE: ${{ vars.HITMUSE_REVIEWED_VISUAL_EVIDENCE }}')
    expect(workflow).toContain('[System.IO.FileMode]::CreateNew')
    expect(workflow).toContain('verify-visual-privacy-review.mjs --read-binding')
    expect(workflow).toContain('verify-visual-privacy-review.mjs --manifest')
    expect(workflow).toContain('VISUAL_PRIVACY_REVIEW_REQUIRED')
    expect(workflow).not.toContain('Write-Output $env:HITMUSE_REVIEWED_VISUAL_EVIDENCE')
  })

  it('rebuilds both native dependencies when switching ABIs', () => {
    const script = readFileSync('scripts/switch-abi.mjs', 'utf8')
    expect(script).toContain("['better-sqlite3', 'nodejieba']")
    expect(script).toContain("'-o', dependency")
    expect(script).not.toContain("'-w', 'better-sqlite3'")
  })

  it('unpacks nodejieba so its native binding can load in the packaged app', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      build: { asarUnpack?: string[] }
    }
    expect(packageJson.build.asarUnpack).toContain('node_modules/nodejieba/**/*')
  })

  it('checks only the HitMuse application process before installing', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      build: { nsis?: { include?: string } }
    }
    expect(packageJson.build.nsis?.include).toBe('build/installer.nsh')

    const installer = readFileSync('build/installer.nsh', 'utf8')
    expect(installer).toContain('customCheckAppRunning')
    expect(installer).toContain('${APP_EXECUTABLE_FILENAME}')
    expect(installer).toContain('taskkill.exe')
    expect(installer).toContain('/F /IM "${APP_EXECUTABLE_FILENAME}"')
    expect(installer).not.toContain('nsProcess::_FindProcess')
    expect(installer).not.toContain('Get-CimInstance')
    expect(installer).not.toContain("Path.StartsWith('$INSTDIR'")
  })

  it('refreshes retained Windows shortcuts with the HitMuse taskbar identity', () => {
    const installer = readFileSync('build/installer.nsh', 'utf8')

    expect(installer).toContain('CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0')
    expect(installer).toContain(
      'WinShell::SetLnkAUMI "$newStartMenuLink" "com.hitmuse.desktop.HitMuse"'
    )
    expect(installer).toContain('CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0')
    expect(installer).toContain(
      'WinShell::SetLnkAUMI "$newDesktopLink" "com.hitmuse.desktop.HitMuse"'
    )
    expect(installer).toContain("Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)")
  })
})
