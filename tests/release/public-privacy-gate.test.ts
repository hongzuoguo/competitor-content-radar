import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { access, copyFile, link, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const scriptPath = resolve('scripts/scan-public-secrets.ps1')
let fixtureRoot = ''
let candidateRoot = ''
let repositoryRoot = ''
let releaseRoot = ''
let reportRoot = ''
let toolRoot = ''

const exactPath = (relativePath: string) => `(?:^|.*[\\\\/])${relativePath.replaceAll('/', '[\\\\/]')}$`
const exactLine = (relativePath: string, line: number) => {
  const value = readFileSync(resolve(relativePath), 'utf8').split('\n')[line - 1].replace(/\r$/, '')
  const indentation = value.match(/^ */)?.[0].length ?? 0
  const content = value.slice(indentation).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return indentation === 0 ? `^${content}$` : `^[ ]{0,${indentation}}${content}$`
}

const approvedGenericApiKeyAllowlists = [
  {
    path: exactPath('src/shared/feishu-template\\.ts'),
    lineRegex: exactLine('src/shared/feishu-template.ts', 1),
  },
  {
    path: exactPath('tests/build/public-repository-boundary\\.test\\.ts'),
    lineRegex: exactLine('tests/build/public-repository-boundary.test.ts', 52),
  },
  {
    path: exactPath('tests/services/feishu-custom-app-auth\\.test\\.ts'),
    lineRegex: exactLine('tests/services/feishu-custom-app-auth.test.ts', 13),
  },
  {
    path: exactPath('tests/services/feishu-custom-app-auth\\.test\\.ts'),
    lineRegex: exactLine('tests/services/feishu-custom-app-auth.test.ts', 31),
  },
  {
    path: exactPath('tests/services/feishu-integration\\.test\\.ts'),
    lineRegex: exactLine('tests/services/feishu-integration.test.ts', 102),
  },
]

const approvedGitleaksFingerprints = [
  'tests/build/public-repository-boundary.test.ts:generic-api-key:52',
  'tests/services/feishu-custom-app-auth.test.ts:generic-api-key:13',
  'tests/services/feishu-custom-app-auth.test.ts:generic-api-key:31',
  'tests/services/feishu-integration.test.ts:generic-api-key:102',
]

function parseGenericApiKeyAllowlists(source: string) {
  return source.split('[[allowlists]]').slice(1).map((block) => {
    const targetRules = block.match(/^targetRules = \["([^"]+)"\]$/m)?.[1]
    const condition = block.match(/^condition = "([^"]+)"$/m)?.[1]
    const regexTarget = block.match(/^regexTarget = "([^"]+)"$/m)?.[1]
    const path = block.match(/^paths = \[\r?\n  '''([\s\S]*?)'''\r?\n\]$/m)?.[1]
    const lineRegex = block.match(/^regexes = \[\r?\n  '''([\s\S]*?)'''\r?\n\]$/m)?.[1]
    return { targetRules, condition, regexTarget, path, lineRegex }
  })
}

async function runScanner() {
  await rm(reportRoot, { recursive: true, force: true })
  await mkdir(reportRoot, { recursive: true })
  return runScannerAt(toolRoot, reportRoot)
}

describe('Gitleaks public allowlists', () => {
  it('permits only the approved fixed template identity and artificial fixtures', () => {
    const source = readFileSync(resolve('.gitleaks.toml'), 'utf8')
    const allowlists = parseGenericApiKeyAllowlists(source)

    expect(source).not.toContain('targetRules')
    expect(allowlists).toHaveLength(5)
    expect(allowlists).toEqual(
      approvedGenericApiKeyAllowlists.map(({ path, lineRegex }) => ({
        targetRules: undefined,
        condition: 'AND',
        regexTarget: 'line',
        path,
        lineRegex,
      })),
    )
  })

  it('tracks only the approved global fingerprints for Git-source fixtures', () => {
    const fingerprints = readFileSync(resolve('.gitleaksignore'), 'utf8').trimEnd().split(/\r?\n/)

    expect(fingerprints).toEqual(approvedGitleaksFingerprints)
    for (const fingerprint of fingerprints) {
      expect(fingerprint).toMatch(/^[a-z0-9/.-]+:generic-api-key:\d+$/)
    }
  })
})

function runScannerThroughNpm() {
  return spawnSync(process.env.ComSpec ?? 'cmd.exe', [
    '/d', '/s', '/c', 'npm.cmd',
    'run', 'verify:public-secrets', '--',
    '-CandidateRoot', candidateRoot,
    '-RepositoryRoot', repositoryRoot,
    '-ReleaseRoot', releaseRoot,
    '-ReportRoot', reportRoot,
    '-ToolRoot', toolRoot
  ], { cwd: resolve(), encoding: 'utf8', windowsHide: true, timeout: 180_000 })
}

function scannerArguments(cacheRoot: string, resultsRoot: string, scannerPath = scriptPath) {
  return [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scannerPath,
    '-CandidateRoot', candidateRoot,
    '-RepositoryRoot', repositoryRoot,
    '-ReleaseRoot', releaseRoot,
    '-ReportRoot', resultsRoot,
    '-ToolRoot', cacheRoot
  ]
}

function runScannerAt(cacheRoot: string, resultsRoot: string) {
  return spawnSync('powershell.exe', scannerArguments(cacheRoot, resultsRoot), { encoding: 'utf8', windowsHide: true, timeout: 180_000 })
}

function runScannerConcurrently(cacheRoot: string, resultsRoot: string, env = process.env, scannerPath = scriptPath) {
  return new Promise<{ status: number | null, stdout: string, stderr: string }>((resolvePromise, reject) => {
    const process = spawn('powershell.exe', scannerArguments(cacheRoot, resultsRoot, scannerPath), { windowsHide: true, env })
    let stdout = ''
    let stderr = ''
    process.stdout.on('data', (chunk) => { stdout += chunk })
    process.stderr.on('data', (chunk) => { stderr += chunk })
    process.on('error', reject)
    process.on('close', (status) => resolvePromise({ status, stdout, stderr }))
  })
}

function loadScannerFunctionsCommand() {
  const source = readFileSync(scriptPath, 'utf8')
  const functionSource = source.slice(0, source.lastIndexOf('\ntry {'))
  return [
    `$source = [System.Convert]::FromBase64String('${Buffer.from(functionSource).toString('base64')}')`,
    'Invoke-Expression ([System.Text.Encoding]::UTF8.GetString($source))'
  ].join('; ')
}

function startBootstrapMutexBarrierProcess(cacheRoot: string, barrierRoot: string, role: 'first' | 'second') {
  const cache = cacheRoot.replace(/'/g, "''")
  const barrier = barrierRoot.replace(/'/g, "''")
  const command = role === 'first'
    ? [
        loadScannerFunctionsCommand(),
        `$barrier = '${barrier}'`,
        `$mutex = Enter-ToolRootBootstrapMutex '${cache}'`,
        "[System.IO.File]::WriteAllText((Join-Path $barrier 'first-acquired'), 'ready')",
        '$deadline = [DateTime]::UtcNow.AddSeconds(10)',
        "while (-not (Test-Path -LiteralPath (Join-Path $barrier 'allow-release'))) { if ([DateTime]::UtcNow -ge $deadline) { throw 'barrier timeout' }; Start-Sleep -Milliseconds 25 }",
        '$mutex.ReleaseMutex()',
        '$mutex.Dispose()',
        "[System.IO.File]::WriteAllText((Join-Path $barrier 'first-released'), 'released')"
      ].join('; ')
    : [
        loadScannerFunctionsCommand(),
        `$barrier = '${barrier}'`,
        "[System.IO.File]::WriteAllText((Join-Path $barrier 'second-waiting'), 'waiting')",
        `$mutex = Enter-ToolRootBootstrapMutex '${cache}'`,
        "[System.IO.File]::WriteAllText((Join-Path $barrier 'second-acquired'), 'acquired')",
        '$mutex.ReleaseMutex()',
        '$mutex.Dispose()'
      ].join('; ')
  const process = spawn('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true })
  let stdout = ''
  let stderr = ''
  const closed = new Promise<{ status: number | null, stdout: string, stderr: string }>((resolvePromise, reject) => {
    process.stdout.on('data', (chunk) => { stdout += chunk })
    process.stderr.on('data', (chunk) => { stderr += chunk })
    process.on('error', reject)
    process.on('close', (status) => resolvePromise({ status, stdout, stderr }))
  })
  return { process, closed }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function waitForBarrier(path: string, timeoutMilliseconds = 10_000) {
  const deadline = Date.now() + timeoutMilliseconds
  while (true) {
    try {
      await access(path)
      return
    } catch {
      if (Date.now() >= deadline) throw new Error(`timed out waiting for barrier ${path}`)
      await delay(25)
    }
  }
}

async function appearsWithin(path: string, observationMilliseconds: number) {
  const deadline = Date.now() + observationMilliseconds
  while (Date.now() < deadline) {
    try {
      await access(path)
      return true
    } catch {
      await delay(25)
    }
  }
  return false
}

function testBarrierSource(hookDirectory: string) {
  const ready = join(hookDirectory, 'ready').replace(/'/g, "''")
  const continuePath = join(hookDirectory, 'continue').replace(/'/g, "''")
  return [
    `  [System.IO.File]::WriteAllText('${ready}', 'ready', [System.Text.UTF8Encoding]::new($false))`,
    '  $testHookDeadline = [DateTime]::UtcNow.AddSeconds(10)',
    `  while (-not (Test-Path -LiteralPath '${continuePath}' -PathType Leaf)) {`,
    "    if ([DateTime]::UtcNow -ge $testHookDeadline) { throw 'TEST_HOOK_TIMEOUT' }",
    '    Start-Sleep -Milliseconds 25',
    '  }'
  ].join('\n')
}

async function createInstrumentedScanner(hookDirectory: string, marker: string, injection = testBarrierSource(hookDirectory)) {
  const instrumentRoot = join(hookDirectory, 'instrumented')
  const instrumentScript = join(instrumentRoot, 'scripts', 'scan-public-secrets.ps1')
  await Promise.all([
    mkdir(join(instrumentRoot, 'scripts'), { recursive: true }),
    mkdir(join(instrumentRoot, 'resources'), { recursive: true })
  ])
  let source = await readFile(scriptPath, 'utf8')
  const hook = `${injection}\n`
  if (!source.includes(marker)) throw new Error(`instrumentation marker missing: ${marker}`)
  source = source.replace(marker, `${marker}\n${hook}`)
  await Promise.all([
    writeFile(instrumentScript, source, 'utf8'),
    copyFile(resolve('.gitleaks.toml'), join(instrumentRoot, '.gitleaks.toml')),
    copyFile(resolve('resources/build-toolchain.json'), join(instrumentRoot, 'resources', 'build-toolchain.json'))
  ])
  return instrumentScript
}

async function stopBootstrapMutexBarrierProcess(process: ReturnType<typeof startBootstrapMutexBarrierProcess> | undefined) {
  if (!process) return
  if (process.process.exitCode === null) process.process.kill()
  await process.closed
}

async function writeSentinel(root: string) {
  const value = `HITMUSE_SENTINEL_${randomBytes(16).toString('hex')}`
  await writeFile(join(root, 'sentinel.txt'), value, 'utf8')
  return value
}

async function createReleaseAsar(files: Record<string, string>) {
  const sourceRoot = join(fixtureRoot, `asar-source-${randomBytes(8).toString('hex')}`)
  const resourcesRoot = join(releaseRoot, 'unpacked', 'resources')
  const archivePath = join(resourcesRoot, 'app.asar')
  await mkdir(resourcesRoot, { recursive: true })
  for (const [relativePath, contents] of Object.entries(files)) {
    const destination = join(sourceRoot, relativePath)
    await mkdir(resolve(destination, '..'), { recursive: true })
    await writeFile(destination, contents, 'utf8')
  }
  execFileSync(process.execPath, [
    '--input-type=module',
    '--eval',
    "import { createPackage } from '@electron/asar'; await createPackage(process.argv[1], process.argv[2])",
    sourceRoot,
    archivePath,
  ], { cwd: resolve(), windowsHide: true })
  return { archivePath, sourceRoot }
}

async function readSafeSummary(resultsRoot = reportRoot) {
  const summaryText = await readFile(join(resultsRoot, 'public-secret-scan-summary.json'), 'utf8')
  expect(summaryText.charCodeAt(0)).not.toBe(0xfeff)
  return { summaryText, summary: JSON.parse(summaryText) }
}

describe('public privacy gate', () => {
  it('initializes the private tool cache from an exact SID descriptor without localized icacls output', async () => {
    const source = await readFile(scriptPath, 'utf8')
    expect(source).toContain('ConvertStringSecurityDescriptorToSecurityDescriptor')
    expect(source).toContain('[HitMuseAclNative]::SetFileSecurity')
    expect(source).not.toContain("'icacls.exe'")
    expect(source).not.toContain('Set-Acl')
  })

  it('preserves drive and UNC volume roots during path normalization', async () => {
    const source = await readFile(scriptPath, 'utf8')
    const functionSource = source.slice(0, source.lastIndexOf('\ntry {'))
    const command = [
      `$source = [System.Convert]::FromBase64String('${Buffer.from(functionSource).toString('base64')}')`,
      'Invoke-Expression ([System.Text.Encoding]::UTF8.GetString($source))',
      '$drive = Assert-AbsolutePath \'C:\\\' \'invalid\'',
      "$unc = Assert-AbsolutePath '\\\\server\\share\\' 'invalid'",
      'Write-Output "drive=$drive"',
      'Write-Output "unc=$unc"',
      'Write-Output "overlap=$(Test-PathOverlap $drive \'C:\\child\')"'
    ].join('; ')
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true })

    expect(result.status).toBe(0)
    expect(result.stdout.trim().split(/\r?\n/)).toEqual([
      'drive=C:\\',
      'unc=\\\\server\\share\\',
      'overlap=True'
    ])
  })

  it('rejects non-local ToolRoot values before initialization', () => {
    const command = [
      loadScannerFunctionsCommand(),
      "function Initialize-ToolRoot([string]$unused) { Write-Output 'INITIALIZE_CALLED' }",
      "$toolRoots = @('\\\\server\\share\\tool', '\\\\?\\C:\\tool', '\\\\.\\C:\\tool')",
      "foreach ($toolRoot in $toolRoots) { try { $tools = Assert-LocalToolRootPath $toolRoot; Initialize-ToolRoot $tools } catch { Write-Output $_.Exception.Message } }"
    ].join('; ')
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim().split(/\r?\n/)).toEqual([
      'PUBLIC_SECRET_SCAN_TOOL_ROOT_NOT_LOCAL',
      'PUBLIC_SECRET_SCAN_TOOL_ROOT_NOT_LOCAL',
      'PUBLIC_SECRET_SCAN_TOOL_ROOT_NOT_LOCAL'
    ])
  })

  it('derives one Global mutex name from case and trailing-slash variants of a drive path', () => {
    const command = [
      loadScannerFunctionsCommand(),
      "$first = Get-ToolRootMutexName 'C:\\Temp\\HitMuseToolRoot\\'",
      "$second = Get-ToolRootMutexName 'c:\\temp\\hitmusetoolroot'",
      'Write-Output $first',
      'Write-Output $second'
    ].join('; ')
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const names = result.stdout.trim().split(/\r?\n/)
    expect(names).toHaveLength(2)
    expect(names[0]).toBe(names[1])
    expect(names[0]).toMatch(/^Global\\HitMuse\.Gitleaks\.ToolRoot\.[a-f0-9]{64}$/)
    expect(names[0]).not.toContain('HitMuseToolRoot')
  })

  it('allows only fixed and RAM ToolRoot drive types', () => {
    const command = [
      loadScannerFunctionsCommand(),
      '$allowed = @([IO.DriveType]::Fixed, [IO.DriveType]::Ram)',
      '$rejected = @([IO.DriveType]::Network, [IO.DriveType]::Unknown, [IO.DriveType]::Removable, [IO.DriveType]::CDRom, [IO.DriveType]::NoRootDirectory)',
      "foreach ($type in $allowed) { try { Assert-SupportedToolDriveType $type | Out-Null; Write-Output 'ALLOWED' } catch { Write-Output $_.Exception.Message } }",
      "foreach ($type in $rejected) { try { Assert-SupportedToolDriveType $type | Out-Null; Write-Output 'REJECTED_TYPE_ALLOWED' } catch { Write-Output $_.Exception.Message } }"
    ].join('; ')
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim().split(/\r?\n/)).toEqual([
      'ALLOWED',
      'ALLOWED',
      'PUBLIC_SECRET_SCAN_TOOL_ROOT_NOT_LOCAL',
      'PUBLIC_SECRET_SCAN_TOOL_ROOT_NOT_LOCAL',
      'PUBLIC_SECRET_SCAN_TOOL_ROOT_NOT_LOCAL',
      'PUBLIC_SECRET_SCAN_TOOL_ROOT_NOT_LOCAL',
      'PUBLIC_SECRET_SCAN_TOOL_ROOT_NOT_LOCAL'
    ])
  })

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'hitmuse-public-privacy-'))
    candidateRoot = join(fixtureRoot, 'candidate')
    repositoryRoot = join(fixtureRoot, 'repository')
    releaseRoot = join(fixtureRoot, 'release')
    reportRoot = join(fixtureRoot, 'reports')
    toolRoot = join(fixtureRoot, 'tool-cache')
    await Promise.all([candidateRoot, repositoryRoot, releaseRoot, reportRoot, toolRoot].map((path) => mkdir(path, { recursive: true })))
    await Promise.all([
      writeFile(join(candidateRoot, 'allowed.txt'), 'clean candidate', 'utf8'),
      writeFile(join(releaseRoot, 'allowed.txt'), 'clean release', 'utf8'),
      writeFile(join(repositoryRoot, 'allowed.txt'), 'clean repository', 'utf8')
    ])
    execFileSync('git', ['init', '--quiet'], { cwd: repositoryRoot, windowsHide: true })
    execFileSync('git', ['add', 'allowed.txt'], { cwd: repositoryRoot, windowsHide: true })
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'clean'], {
      cwd: repositoryRoot,
      windowsHide: true
    })
  }, 30_000)

  afterAll(async () => {
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true })
  })

  it('accepts the current ToolRoot drive', () => {
    const command = [
      loadScannerFunctionsCommand(),
      `Assert-LocalToolRootPath '${toolRoot.replace(/'/g, "''")}' | Out-Null`,
      "Write-Output 'TOOL_ROOT_OK'"
    ].join('; ')
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim()).toBe('TOOL_ROOT_OK')
  })

  it('keeps scanner reports out of the release directory through the npm entry point', async () => {
    const result = runScannerThroughNpm()

    expect(result.status).toBe(0)
    expect(result.stdout.split(/\r?\n/)).toContain('PUBLIC_SECRET_SCAN_OK')
    expect(result.stderr.trim()).toBe('')
    const { summaryText, summary } = await readSafeSummary()
    expect(`${result.stdout}${result.stderr}${summaryText}`.includes('HITMUSE_SENTINEL_')).toBe(false)
    expect(summary).toEqual({ totalFindings: 0, displayedFindings: 0, truncated: false, findings: [] })
    expect(await readdir(reportRoot)).toEqual(['public-secret-scan-summary.json'])
    expect(await readdir(releaseRoot)).toEqual(['allowed.txt'])
  }, 180_000)

  it('pins the validated report root so it cannot be replaced with a junction during a scan', async () => {
    const raceRoot = join(fixtureRoot, 'report-root-race')
    const raceReport = join(raceRoot, 'report')
    const displacedReport = join(raceRoot, 'displaced-report')
    const outsideReport = join(raceRoot, 'outside-report')
    const hookDirectory = join(raceRoot, 'hook')
    await Promise.all([raceReport, outsideReport, hookDirectory].map((path) => mkdir(path, { recursive: true })))
    const source = await readFile(scriptPath, 'utf8')
    expect(source).not.toContain('HITMUSE_SECRET_SCAN_TEST_HOOK_DIRECTORY')
    const instrumentedScanner = await createInstrumentedScanner(hookDirectory, '  $safeFailureReport = $report')
    const scanner = runScannerConcurrently(toolRoot, raceReport, process.env, instrumentedScanner)
    let result: { status: number | null, stdout: string, stderr: string } | undefined
    let swapped = false
    try {
      await waitForBarrier(join(hookDirectory, 'ready'))
      try {
        await rename(raceReport, displacedReport)
        execFileSync('powershell.exe', [
          '-NoProfile', '-Command', `New-Item -ItemType Junction -Path '${raceReport}' -Target '${outsideReport}' | Out-Null`
        ], { windowsHide: true })
        swapped = true
      } catch {
        // The pinned directory intentionally rejects this rename.
      }
      expect(swapped).toBe(false)
    } finally {
      await writeFile(join(hookDirectory, 'continue'), 'continue', 'utf8')
      result = await scanner
    }

    expect(result?.status).toBe(0)
    expect(result?.stdout.trim()).toBe('PUBLIC_SECRET_SCAN_OK')
    expect(result?.stderr).toBe('')
    expect(await readdir(outsideReport)).toEqual([])
    expect((await readSafeSummary(raceReport)).summary).toEqual({ totalFindings: 0, displayedFindings: 0, truncated: false, findings: [] })
  }, 180_000)

  it('does not overwrite a pre-existing summary destination', async () => {
    const caseRoot = join(fixtureRoot, 'summary-symlink')
    const caseReport = join(caseRoot, 'report')
    const outsideSummary = join(caseRoot, 'outside-summary.json')
    const summaryDestination = join(caseReport, 'public-secret-scan-summary.json')
    await mkdir(caseReport, { recursive: true })
    await writeFile(outsideSummary, 'outside summary must survive', 'utf8')
    await link(outsideSummary, summaryDestination)

    const result = runScannerAt(toolRoot, caseReport)

    expect(result.status).not.toBe(0)
    expect(result.stdout.trim()).toBe('PUBLIC_SECRET_SCAN_FAILED:0')
    expect(result.stderr.trim()).toBe('')
    expect(await readFile(outsideSummary, 'utf8')).toBe('outside summary must survive')
  }, 180_000)

  it('holds the bootstrap mutex while a second process waits at the barrier', async () => {
    const concurrentToolRoot = join(fixtureRoot, 'bootstrap-mutex-tool-cache')
    const barrierRoot = join(fixtureRoot, 'bootstrap-mutex-barrier')
    await mkdir(barrierRoot)
    let first: ReturnType<typeof startBootstrapMutexBarrierProcess> | undefined
    let second: ReturnType<typeof startBootstrapMutexBarrierProcess> | undefined
    try {
      first = startBootstrapMutexBarrierProcess(concurrentToolRoot, barrierRoot, 'first')
      await waitForBarrier(join(barrierRoot, 'first-acquired'))
      second = startBootstrapMutexBarrierProcess(concurrentToolRoot, barrierRoot, 'second')
      await waitForBarrier(join(barrierRoot, 'second-waiting'))
      expect(await appearsWithin(join(barrierRoot, 'second-acquired'), 500)).toBe(false)
      await writeFile(join(barrierRoot, 'allow-release'), 'allow', 'utf8')
      const firstResult = await first.closed
      const secondResult = await second.closed

      expect(firstResult).toEqual({ status: 0, stdout: '', stderr: '' })
      expect(secondResult).toEqual({ status: 0, stdout: '', stderr: '' })
      await waitForBarrier(join(barrierRoot, 'first-released'))
      await waitForBarrier(join(barrierRoot, 'second-acquired'))
      const source = await readFile(scriptPath, 'utf8')
      expect(source).toMatch(/return 'Global\\HitMuse\.Gitleaks\.ToolRoot\.' \+ \$hash/)
    } finally {
      await rm(join(barrierRoot, 'allow-release'), { force: true })
      await Promise.all([stopBootstrapMutexBarrierProcess(second), stopBootstrapMutexBarrierProcess(first)])
    }
  }, 30_000)

  it('disposes a bootstrap mutex when release fails', async () => {
    const command = [
      loadScannerFunctionsCommand(),
      '$state = [pscustomobject]@{ Disposed = $false }',
      '$mutex = [pscustomobject]@{ State = $state }',
      "$mutex | Add-Member -MemberType ScriptMethod -Name ReleaseMutex -Value { throw 'release failed' }",
      '$mutex | Add-Member -MemberType ScriptMethod -Name Dispose -Value { $this.State.Disposed = $true }',
      "try { Exit-ToolRootBootstrapMutex $mutex } catch { Write-Output 'RELEASE_FAILED' }",
      'Write-Output "DISPOSED=$($state.Disposed)"'
    ].join('; ')
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim().split(/\r?\n/)).toEqual(['RELEASE_FAILED', 'DISPOSED=True'])
  })

  it('serializes concurrent installation into a fresh private cache', async () => {
    for (const suffix of ['one', 'two']) {
      const concurrentToolRoot = join(fixtureRoot, `concurrent-tool-cache-${suffix}`)
      const firstReport = join(fixtureRoot, `concurrent-report-${suffix}-one`)
      const secondReport = join(fixtureRoot, `concurrent-report-${suffix}-two`)

      const [first, second] = await Promise.all([
        runScannerConcurrently(concurrentToolRoot, firstReport),
        runScannerConcurrently(concurrentToolRoot, secondReport)
      ])

      expect([first.status, second.status]).toEqual([0, 0])
      expect(first.stdout.trim()).toBe('PUBLIC_SECRET_SCAN_OK')
      expect(second.stdout.trim()).toBe('PUBLIC_SECRET_SCAN_OK')
    }
  }, 360_000)

  it('rejects a cached archive modified after a clean installation', async () => {
    const freshToolRoot = join(fixtureRoot, 'archive-tamper-tool-cache')
    const firstReport = join(fixtureRoot, 'archive-tamper-report-one')
    const secondReport = join(fixtureRoot, 'archive-tamper-report-two')

    const first = runScannerAt(freshToolRoot, firstReport)
    expect(first.status).toBe(0)
    expect(first.stdout.trim()).toBe('PUBLIC_SECRET_SCAN_OK')
    const archive = join(freshToolRoot, 'gitleaks_8.30.0_windows_x64.zip')
    const bytes = await readFile(archive)
    bytes[0] ^= 0xff
    await writeFile(archive, bytes)

    const second = runScannerAt(freshToolRoot, secondReport)
    expect(second.status).not.toBe(0)
    expect(second.stdout.trim()).toBe('PUBLIC_SECRET_SCAN_FAILED:0')
    expect(second.stderr.trim()).toBe('')
    expect((await readSafeSummary(secondReport)).summary).toEqual({
      error: 'PUBLIC_SECRET_SCAN_tool',
      reason: 'PUBLIC_SECRET_SCAN_TOOL_ARCHIVE_INVALID'
    })
  }, 180_000)

  it('rejects a zip entry which escapes the extraction staging directory', async () => {
    const zipPath = join(fixtureRoot, 'zip-slip.zip')
    const staging = join(fixtureRoot, 'zip-slip-staging')
    const source = await readFile(scriptPath, 'utf8')
    const functionSource = source.slice(0, source.lastIndexOf('\ntry {'))
    const command = [
      `$source = [System.Convert]::FromBase64String('${Buffer.from(functionSource).toString('base64')}')`,
      'Invoke-Expression ([System.Text.Encoding]::UTF8.GetString($source))',
      'Add-Type -AssemblyName System.IO.Compression',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      `$zip = [System.IO.Compression.ZipFile]::Open('${zipPath.replace(/\\/g, '\\\\')}', [System.IO.Compression.ZipArchiveMode]::Create)`,
      "$entry = $zip.CreateEntry('../escaped.txt')",
      '$entry.Open().Dispose()',
      '$zip.Dispose()',
      `try { Expand-GitleaksArchive '${zipPath.replace(/\\/g, '\\\\')}' '${staging.replace(/\\/g, '\\\\')}' } catch { Write-Output $_.Exception.Message }`
    ].join('; ')
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('PUBLIC_SECRET_SCAN_TOOL_EXTRACT_INVALID')
  })

  it('rejects duplicate zip entries before extracting either copy', async () => {
    const zipPath = join(fixtureRoot, 'duplicate-entry.zip')
    const staging = join(fixtureRoot, 'duplicate-entry-staging')
    const source = await readFile(scriptPath, 'utf8')
    const functionSource = source.slice(0, source.lastIndexOf('\ntry {'))
    const command = [
      `$source = [System.Convert]::FromBase64String('${Buffer.from(functionSource).toString('base64')}')`,
      'Invoke-Expression ([System.Text.Encoding]::UTF8.GetString($source))',
      'Add-Type -AssemblyName System.IO.Compression',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      `$zip = [System.IO.Compression.ZipFile]::Open('${zipPath.replace(/\\/g, '\\\\')}', [System.IO.Compression.ZipArchiveMode]::Create)`,
      "$zip.CreateEntry('duplicate.txt').Open().Dispose()",
      "$zip.CreateEntry('duplicate.txt').Open().Dispose()",
      '$zip.Dispose()',
      `try { Expand-GitleaksArchive '${zipPath.replace(/\\/g, '\\\\')}' '${staging.replace(/\\/g, '\\\\')}' } catch { Write-Output $_.Exception.Message }`
    ].join('; ')
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('PUBLIC_SECRET_SCAN_TOOL_EXTRACT_INVALID')
  })

  it('cleans malformed raw reports without exposing their contents', async () => {
    const rawPath = join(fixtureRoot, 'malformed.raw.json')
    const rawContent = '{not valid json}'
    await writeFile(rawPath, rawContent, 'utf8')
    const source = await readFile(scriptPath, 'utf8')
    const functionSource = source.slice(0, source.lastIndexOf('\ntry {'))
    const command = [
      `$source = [System.Convert]::FromBase64String('${Buffer.from(functionSource).toString('base64')}')`,
      'Invoke-Expression ([System.Text.Encoding]::UTF8.GetString($source))',
      `try { Read-GitleaksFindings '${rawPath.replace(/\\/g, '\\\\')}' | Out-Null } catch { Write-Output $_.Exception.Message }`
    ].join('; ')
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true })

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('PUBLIC_SECRET_SCAN_REPORT_INVALID')
    expect(result.stderr.trim()).toBe('')
    expect(`${result.stdout}${result.stderr}`).not.toContain(rawContent)
    expect(await readdir(fixtureRoot)).not.toContain('malformed.raw.json')
  })

  it.each(['candidate', 'release'] as const)('fails safely when %s contains the sentinel', async (kind) => {
    const target = kind === 'candidate' ? candidateRoot : releaseRoot
    const sentinel = await writeSentinel(target)
    try {
      const result = await runScanner()
      const { summaryText, summary } = await readSafeSummary()
      const leaked = `${result.stdout}${result.stderr}${summaryText}`.includes(sentinel)

      expect(result.status).not.toBe(0)
      expect(result.stdout.trim()).toBe(`PUBLIC_SECRET_SCAN_FAILED:${summary.totalFindings}`)
      expect(result.stderr.trim()).toBe('')
      expect(leaked).toBe(false)
      expect(summary.displayedFindings).toBe(summary.findings.length)
      expect(summary.truncated).toBe(summary.totalFindings > summary.displayedFindings)
      expect(summary.findings.some((finding: { ruleId: string; path: string; scanKind: string }) =>
        finding.ruleId === 'hitmuse-runtime-sentinel' && finding.path === 'sentinel.txt' && finding.scanKind === kind
      )).toBe(true)
    } finally {
      await rm(join(target, 'sentinel.txt'), { force: true })
    }
  }, 180_000)

  it('extracts and scans app.asar while accepting the fixed public template identity', async () => {
    const templateSource = await readFile(resolve('src/shared/feishu-template.ts'), 'utf8')
    const templateToken = templateSource.match(/FEISHU_TEMPLATE_APP_TOKEN = '([^']+)'/)?.[1]
    expect(templateToken).toBeTruthy()
    const { sourceRoot } = await createReleaseAsar({
      'out/renderer/assets/index-test.js': `const FEISHU_TEMPLATE_APP_TOKEN = "${templateToken}";\n`,
    })
    try {
      const result = await runScanner()
      const { summary } = await readSafeSummary()

      expect(result.status).toBe(0)
      expect(result.stdout.trim()).toBe('PUBLIC_SECRET_SCAN_OK')
      expect(result.stderr.trim()).toBe('')
      expect(summary).toEqual({ totalFindings: 0, displayedFindings: 0, truncated: false, findings: [] })
    } finally {
      await rm(join(releaseRoot, 'unpacked'), { recursive: true, force: true })
      await rm(sourceRoot, { recursive: true, force: true })
    }
  }, 180_000)

  it('finds a secret sentinel embedded inside app.asar without exposing it', async () => {
    const sentinel = `HITMUSE_SENTINEL_${randomBytes(16).toString('hex')}`
    const { sourceRoot } = await createReleaseAsar({
      'out/renderer/sentinel.js': `export const value = "${sentinel}";\n`,
    })
    try {
      const result = await runScanner()
      const { summaryText, summary } = await readSafeSummary()

      expect(result.status).not.toBe(0)
      expect(result.stdout.trim()).toBe(`PUBLIC_SECRET_SCAN_FAILED:${summary.totalFindings}`)
      expect(result.stderr.trim()).toBe('')
      expect(`${result.stdout}${result.stderr}${summaryText}`).not.toContain(sentinel)
      expect(summary.findings).toContainEqual({
        ruleId: 'hitmuse-runtime-sentinel',
        path: 'out/renderer/sentinel.js',
        scanKind: 'release-app-asar',
      })
    } finally {
      await rm(join(releaseRoot, 'unpacked'), { recursive: true, force: true })
      await rm(sourceRoot, { recursive: true, force: true })
    }
  }, 180_000)

  it('does not follow a raw-report hard link planted after cleanup', async () => {
    const caseRoot = join(fixtureRoot, 'raw-report-race')
    const caseReport = join(caseRoot, 'report')
    const outsideRaw = join(caseRoot, 'outside.raw.json')
    const hookDirectory = join(caseRoot, 'hook')
    await Promise.all([caseReport, hookDirectory].map((path) => mkdir(path, { recursive: true })))
    await writeFile(outsideRaw, 'outside raw must survive', 'utf8')
    await writeSentinel(candidateRoot)
    const instrumentedScanner = await createInstrumentedScanner(
      hookDirectory,
      '  $previousErrorActionPreference = $ErrorActionPreference',
      ["  if ($Kind -eq 'candidate') {", testBarrierSource(hookDirectory), '  }'].join('\n')
    )
    const scanner = runScannerConcurrently(toolRoot, caseReport, process.env, instrumentedScanner)
    let result: { status: number | null, stdout: string, stderr: string } | undefined
    try {
      await waitForBarrier(join(hookDirectory, 'ready'))
      await link(outsideRaw, join(caseReport, 'candidate.raw.json'))
    } finally {
      await writeFile(join(hookDirectory, 'continue'), 'continue', 'utf8')
      result = await scanner
    }

    expect(result?.status).not.toBe(0)
    expect(result?.stdout.trim()).toMatch(/^PUBLIC_SECRET_SCAN_FAILED:\d+$/)
    expect(result?.stderr).toBe('')
    expect(await readFile(outsideRaw, 'utf8')).toBe('outside raw must survive')
  }, 180_000)

  it('finds a repository sentinel committed only on a non-current branch', async () => {
    const cleanBranch = execFileSync('git', ['branch', '--show-current'], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true }).trim()
    const historyBranch = 'history-only-sentinel'
    const historyFile = 'history-only-sentinel.txt'
    const sentinel = `HITMUSE_SENTINEL_${randomBytes(16).toString('hex')}`

    execFileSync('git', ['checkout', '--quiet', '-b', historyBranch], { cwd: repositoryRoot, windowsHide: true })
    try {
      await writeFile(join(repositoryRoot, historyFile), sentinel, 'utf8')
      execFileSync('git', ['add', historyFile], { cwd: repositoryRoot, windowsHide: true })
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'history sentinel'], {
        cwd: repositoryRoot,
        windowsHide: true
      })
      execFileSync('git', ['checkout', '--quiet', cleanBranch], { cwd: repositoryRoot, windowsHide: true })
      expect(await readdir(repositoryRoot)).not.toContain(historyFile)
      expect(execFileSync('git', ['status', '--short'], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true })).toBe('')

      const result = await runScanner()
      const { summaryText, summary } = await readSafeSummary()

      expect(result.status).not.toBe(0)
      expect(result.stdout.trim()).toBe(`PUBLIC_SECRET_SCAN_FAILED:${summary.totalFindings}`)
      expect(result.stderr.trim()).toBe('')
      expect(`${result.stdout}${result.stderr}${summaryText}`).not.toContain(sentinel)
      expect(summary.findings.some((finding: { ruleId: string; path: string; scanKind: string }) =>
        finding.ruleId === 'hitmuse-runtime-sentinel' && finding.path === historyFile && finding.scanKind === 'repository'
      )).toBe(true)
    } finally {
      const currentBranch = execFileSync('git', ['branch', '--show-current'], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true }).trim()
      if (currentBranch !== cleanBranch) execFileSync('git', ['checkout', '--quiet', cleanBranch], { cwd: repositoryRoot, windowsHide: true })
      execFileSync('git', ['branch', '-D', historyBranch], { cwd: repositoryRoot, windowsHide: true })
    }
  }, 180_000)

  it('caps displayed runtime findings at 100 without leaking any sentinel into scanner output', async () => {
    const sentinels = await Promise.all(Array.from({ length: 101 }, async (_, index) => {
      const sentinel = `HITMUSE_SENTINEL_${randomBytes(16).toString('hex')}`
      await writeFile(join(candidateRoot, `sentinel-${index}.txt`), sentinel, 'utf8')
      return sentinel
    }))

    const result = await runScanner()
    const { summaryText, summary } = await readSafeSummary()
    const leaked = sentinels.some((sentinel) => `${result.stdout}${result.stderr}${summaryText}`.includes(sentinel))

    expect(result.status).not.toBe(0)
    expect(result.stdout.trim()).toBe(`PUBLIC_SECRET_SCAN_FAILED:${summary.totalFindings}`)
    expect(result.stderr.trim()).toBe('')
    expect(leaked).toBe(false)
    expect(summary.totalFindings).toBeGreaterThanOrEqual(101)
    expect(summary.displayedFindings).toBe(100)
    expect(summary.truncated).toBe(true)
    expect(summary.findings).toHaveLength(100)
  }, 180_000)

  it('rejects relative, overlapping, and reparse-point roots', async () => {
    const reparseRoot = join(fixtureRoot, 'candidate-junction')
    const failureReport = join(fixtureRoot, 'invalid-root-report')
    await mkdir(failureReport, { recursive: true })
    execFileSync('powershell.exe', [
      '-NoProfile', '-Command', `New-Item -ItemType Junction -Path '${reparseRoot}' -Target '${candidateRoot}' | Out-Null`
    ], { windowsHide: true })
    const relative = spawnSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
      '-CandidateRoot', 'relative', '-RepositoryRoot', repositoryRoot, '-ReleaseRoot', releaseRoot,
      '-ReportRoot', failureReport, '-ToolRoot', toolRoot
    ], { encoding: 'utf8', windowsHide: true })
    const overlap = spawnSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
      '-CandidateRoot', candidateRoot, '-RepositoryRoot', candidateRoot, '-ReleaseRoot', releaseRoot,
      '-ReportRoot', failureReport, '-ToolRoot', toolRoot
    ], { encoding: 'utf8', windowsHide: true })
    const reparse = spawnSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
      '-CandidateRoot', reparseRoot, '-RepositoryRoot', repositoryRoot, '-ReleaseRoot', releaseRoot,
      '-ReportRoot', failureReport, '-ToolRoot', toolRoot
    ], { encoding: 'utf8', windowsHide: true })

    expect(relative.status).not.toBe(0)
    expect(relative.stdout.trim()).toMatch(/^PUBLIC_SECRET_SCAN_FAILED:\d+$/)
    expect(relative.stderr.trim()).toBe('')
    expect(overlap.status).not.toBe(0)
    expect(overlap.stdout.trim()).toMatch(/^PUBLIC_SECRET_SCAN_FAILED:\d+$/)
    expect(overlap.stderr.trim()).toBe('')
    expect(reparse.status).not.toBe(0)
    expect(reparse.stdout.trim()).toMatch(/^PUBLIC_SECRET_SCAN_FAILED:\d+$/)
    expect(reparse.stderr.trim()).toBe('')
    const { summary } = await readSafeSummary(failureReport)
    expect(summary).toEqual({
      error: 'PUBLIC_SECRET_SCAN_paths',
      reason: 'PUBLIC_SECRET_SCAN_PATH_OVERLAP'
    })
  })

  it.each(['candidate', 'repository', 'release', 'report', 'tool'] as const)('rejects a reparse-point %s root before scanning', async (kind) => {
    const caseRoot = join(fixtureRoot, `reparse-${kind}`)
    const roots = {
      candidate: join(caseRoot, 'candidate'),
      repository: join(caseRoot, 'repository'),
      release: join(caseRoot, 'release'),
      report: join(caseRoot, 'report'),
      tool: join(caseRoot, 'tool')
    }
    const target = join(caseRoot, `${kind}-target`)
    const junction = join(caseRoot, `${kind}-junction`)
    await Promise.all([...Object.values(roots), target].map((path) => mkdir(path, { recursive: true })))
    execFileSync('powershell.exe', [
      '-NoProfile', '-Command', `New-Item -ItemType Junction -Path '${junction}' -Target '${target}' | Out-Null`
    ], { windowsHide: true })
    roots[kind] = junction

    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
      '-CandidateRoot', roots.candidate,
      '-RepositoryRoot', roots.repository,
      '-ReleaseRoot', roots.release,
      '-ReportRoot', roots.report,
      '-ToolRoot', roots.tool
    ], { encoding: 'utf8', windowsHide: true })

    expect(result.status).not.toBe(0)
    expect(result.stdout.trim()).toBe('PUBLIC_SECRET_SCAN_FAILED:0')
    expect(result.stderr.trim()).toBe('')
    if (kind === 'report') {
      expect(await readdir(target)).toEqual([])
    } else {
      const { summaryText, summary } = await readSafeSummary(roots.report)
      expect(summaryText).not.toContain('HITMUSE_SENTINEL_')
      expect(summary).toEqual({
        error: 'PUBLIC_SECRET_SCAN_paths',
        reason: 'PUBLIC_SECRET_SCAN_REPARSE_POINT'
      })
    }
  })

  it('does not write a failure summary through an overlapping report root', async () => {
    const caseRoot = join(fixtureRoot, 'overlapping-report-root')
    const candidate = join(caseRoot, 'candidate')
    const repository = join(caseRoot, 'repository')
    const release = join(caseRoot, 'release')
    const tool = join(caseRoot, 'tool')
    await Promise.all([candidate, repository, release, tool].map((path) => mkdir(path, { recursive: true })))

    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
      '-CandidateRoot', candidate,
      '-RepositoryRoot', repository,
      '-ReleaseRoot', release,
      '-ReportRoot', candidate,
      '-ToolRoot', tool
    ], { encoding: 'utf8', windowsHide: true })

    expect(result.status).not.toBe(0)
    expect(result.stdout.trim()).toBe('PUBLIC_SECRET_SCAN_FAILED:0')
    expect(result.stderr.trim()).toBe('')
    expect(await readdir(candidate)).toEqual([])
  })

  it('rejects a cache executable modified after installation', async () => {
    const executable = join(toolRoot, 'gitleaks-8.30.0', 'gitleaks.exe')
    const bytes = await readFile(executable)
    bytes[0] ^= 0xff
    await writeFile(executable, bytes)

    const result = await runScanner()

    expect(result.status).not.toBe(0)
    expect(result.stdout.trim()).toBe('PUBLIC_SECRET_SCAN_FAILED:0')
  })

  it('rejects a cache ACL with an additional Authenticated Users ACE', async () => {
    execFileSync('powershell.exe', [
      '-NoProfile', '-Command', `& "$env:SystemRoot\\System32\\icacls.exe" '${toolRoot}' /grant '*S-1-5-11:(OI)(CI)F' | Out-Null`
    ], { windowsHide: true })

    const result = await runScanner()

    expect(result.status).not.toBe(0)
    expect(result.stdout.trim()).toBe('PUBLIC_SECRET_SCAN_FAILED:0')
  })
})
