import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const script = join(process.cwd(), 'scripts', 'build-visual-privacy-manifest.mjs')
const modulePath = '../../scripts/build-visual-privacy-manifest.mjs'

function existingAncestors(path: string): string[] {
  const ancestors: string[] = []
  let current = resolve(path)
  while (true) {
    try {
      lstatSync(current)
      ancestors.push(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const parent = dirname(current)
    if (parent === current) return ancestors
    current = parent
  }
}

function uniqueSorted(paths: string[]): string[] {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right))
}

describe('visual privacy manifest', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('exports a guarded manifest builder for atomic checks', async () => {
    const module = await import(modulePath)
    expect(typeof module.buildVisualPrivacyManifest === 'function').toBe(true)
  })

  it('writes a BOM-free review manifest with only asset metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'visual-privacy-manifest-'))
    roots.push(root)
    const candidate = join(root, 'candidate')
    const release = join(root, 'release')
    const report = join(root, 'report', 'visuals.json')
    mkdirSync(join(candidate, 'nested'), { recursive: true })
    mkdirSync(release, { recursive: true })
    writeFileSync(join(candidate, 'nested', 'cover.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    writeFileSync(join(candidate, 'notes.txt'), 'not visual', 'utf8')
    writeFileSync(join(release, 'release.jpg'), Buffer.from([0xff, 0xd8, 0xff]))

    const result = spawnSync(process.execPath, [script, '--candidate-root', candidate, '--release-root', release, '--report-path', report], {
      encoding: 'utf8'
    })
    const manifestText = readFileSync(report, 'utf8')
    const manifest = JSON.parse(manifestText) as { assets: Array<Record<string, unknown>> }

    expect(result.status === 0).toBe(true)
    expect(manifestText.charCodeAt(0) === 0xfeff).toBe(false)
    expect(manifest.assets).toEqual([{
      path: 'candidate/nested/cover.png', bytes: 4, sha256: expect.stringMatching(/^[a-f0-9]{64}$/), status: 'REVIEW_REQUIRED'
    }, {
      path: 'release/release.jpg', bytes: 3, sha256: expect.stringMatching(/^[a-f0-9]{64}$/), status: 'REVIEW_REQUIRED'
    }])
    expect(JSON.stringify(manifest).includes(candidate)).toBe(false)
    expect(JSON.stringify(manifest).includes(release)).toBe(false)
  })

  it('rejects overlapping roots before writing a report', () => {
    const root = mkdtempSync(join(tmpdir(), 'visual-privacy-overlap-'))
    roots.push(root)
    const candidate = join(root, 'candidate')
    const release = join(candidate, 'release')
    const report = join(root, 'report.json')
    mkdirSync(release, { recursive: true })

    const result = spawnSync(process.execPath, [script, '--candidate-root', candidate, '--release-root', release, '--report-path', report], {
      encoding: 'utf8'
    })

    expect(result.status === 1).toBe(true)
  })

  it.each(['candidate', 'release'] as const)('rejects a report path inside the %s root', (location) => {
    const root = mkdtempSync(join(tmpdir(), 'visual-privacy-report-overlap-'))
    roots.push(root)
    const candidate = join(root, 'candidate')
    const release = join(root, 'release')
    const report = join(location === 'candidate' ? candidate : release, 'report', 'visuals.json')
    mkdirSync(candidate, { recursive: true })
    mkdirSync(release, { recursive: true })

    const result = spawnSync(process.execPath, [script, '--candidate-root', candidate, '--release-root', release, '--report-path', report], {
      encoding: 'utf8'
    })

    expect(result.status === 1).toBe(true)
    expect(existsSync(report)).toBe(false)
  })

  it.each(['candidate', 'release', 'report'] as const)('rejects a %s ancestor junction before writing', (location) => {
    const root = mkdtempSync(join(tmpdir(), 'visual-privacy-junction-'))
    roots.push(root)
    const candidateTarget = join(root, 'candidate-target')
    const releaseTarget = join(root, 'release-target')
    const reportTarget = join(root, 'report-target')
    mkdirSync(join(candidateTarget, 'candidate'), { recursive: true })
    mkdirSync(join(releaseTarget, 'release'), { recursive: true })
    mkdirSync(join(reportTarget, 'report'), { recursive: true })
    const candidate = location === 'candidate' ? join(root, 'candidate-link', 'candidate') : join(candidateTarget, 'candidate')
    const release = location === 'release' ? join(root, 'release-link', 'release') : join(releaseTarget, 'release')
    const reportParent = location === 'report' ? join(root, 'report-link', 'report') : join(reportTarget, 'report')
    if (location === 'candidate') symlinkSync(candidateTarget, join(root, 'candidate-link'), 'junction')
    if (location === 'release') symlinkSync(releaseTarget, join(root, 'release-link'), 'junction')
    if (location === 'report') symlinkSync(reportTarget, join(root, 'report-link'), 'junction')
    const report = join(reportParent, 'visuals.json')

    const result = spawnSync(process.execPath, [script, '--candidate-root', candidate, '--release-root', release, '--report-path', report], {
      encoding: 'utf8'
    })

    expect(result.status === 1).toBe(true)
    expect(existsSync(join(reportTarget, 'report', 'visuals.json'))).toBe(false)
  })

  it.each(['candidate', 'release', 'report'] as const)('rejects a %s root junction before writing', (location) => {
    const root = mkdtempSync(join(tmpdir(), 'visual-privacy-root-junction-'))
    roots.push(root)
    const candidateTarget = join(root, 'candidate-target')
    const releaseTarget = join(root, 'release-target')
    const reportTarget = join(root, 'report-target')
    mkdirSync(candidateTarget, { recursive: true })
    mkdirSync(releaseTarget, { recursive: true })
    mkdirSync(reportTarget, { recursive: true })
    const candidate = location === 'candidate' ? join(root, 'candidate') : candidateTarget
    const release = location === 'release' ? join(root, 'release') : releaseTarget
    const reportParent = location === 'report' ? join(root, 'report') : reportTarget
    if (location === 'candidate') symlinkSync(candidateTarget, candidate, 'junction')
    if (location === 'release') symlinkSync(releaseTarget, release, 'junction')
    if (location === 'report') symlinkSync(reportTarget, reportParent, 'junction')
    const report = join(reportParent, 'visuals.json')

    const result = spawnSync(process.execPath, [script, '--candidate-root', candidate, '--release-root', release, '--report-path', report], {
      encoding: 'utf8'
    })

    expect(result.status).toBe(1)
    expect(existsSync(join(reportTarget, 'visuals.json'))).toBe(false)
  })

  it('rejects an existing report and does not overwrite it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'visual-privacy-existing-report-'))
    roots.push(root)
    const candidate = join(root, 'candidate')
    const release = join(root, 'release')
    const report = join(root, 'report', 'visuals.json')
    mkdirSync(candidate, { recursive: true })
    mkdirSync(release, { recursive: true })
    mkdirSync(join(root, 'report'), { recursive: true })
    writeFileSync(report, 'existing', 'utf8')
    const { buildVisualPrivacyManifest } = await import(modulePath)

    await expect(buildVisualPrivacyManifest({ candidateRoot: candidate, releaseRoot: release, reportPath: report }))
      .rejects.toThrow('VISUAL_PRIVACY_MANIFEST_INVALID')
    expect(readFileSync(report, 'utf8') === 'existing').toBe(true)
  })

  it('enforces injected depth, asset-count, file-size, and total-size limits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'visual-privacy-limits-'))
    roots.push(root)
    const { buildVisualPrivacyManifest } = await import(modulePath)
    const cases = [
      { name: 'depth', files: [['nested/a.png', 1]], limits: { maxDepth: 0 } },
      { name: 'count', files: [['a.png', 1], ['b.png', 1]], limits: { maxAssets: 1 } },
      { name: 'file', files: [['a.png', 4]], limits: { maxFileBytes: 3 } },
      { name: 'total', files: [['a.png', 3], ['b.png', 3]], limits: { maxTotalBytes: 5 } }
    ] as const

    for (const testCase of cases) {
      const candidate = join(root, `${testCase.name}-candidate`)
      const release = join(root, `${testCase.name}-release`)
      const report = join(root, `${testCase.name}-report`, 'visuals.json')
      mkdirSync(candidate, { recursive: true })
      mkdirSync(release, { recursive: true })
      for (const [relativePath, bytes] of testCase.files) {
        const file = join(candidate, relativePath)
        mkdirSync(join(file, '..'), { recursive: true })
        writeFileSync(file, Buffer.alloc(bytes))
      }
      await expect(buildVisualPrivacyManifest({ candidateRoot: candidate, releaseRoot: release, reportPath: report, limits: testCase.limits }))
        .rejects.toThrow('VISUAL_PRIVACY_MANIFEST_INVALID')
      expect(existsSync(report)).toBe(false)
    }
  })

  it('enforces the audit entry limit for non-visual directory entries independently of asset limits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'visual-privacy-entry-limit-'))
    roots.push(root)
    const candidate = join(root, 'candidate')
    const release = join(root, 'release')
    const report = join(root, 'report', 'visuals.json')
    mkdirSync(candidate, { recursive: true })
    mkdirSync(release, { recursive: true })
    writeFileSync(join(candidate, 'a.txt'), 'a')
    writeFileSync(join(candidate, 'b.txt'), 'b')
    const { buildVisualPrivacyManifest } = await import(modulePath)

    await expect(buildVisualPrivacyManifest({
      candidateRoot: candidate,
      releaseRoot: release,
      reportPath: report,
      limits: { maxAuditEntries: 1 },
      reparseAudit: () => {}
    })).rejects.toThrow('VISUAL_PRIVACY_MANIFEST_INVALID')
    expect(existsSync(report)).toBe(false)
  })

  it('sends complete phase-specific batched audit payloads in publish order', async () => {
    const root = mkdtempSync(join(tmpdir(), 'visual-privacy-batched-audits-'))
    roots.push(root)
    const candidate = join(root, 'candidate')
    const release = join(root, 'release')
    const report = join(root, 'report', 'visuals.json')
    mkdirSync(candidate, { recursive: true })
    mkdirSync(release, { recursive: true })
    mkdirSync(join(root, 'report'), { recursive: true })
    const phaseOneExact = uniqueSorted([...existingAncestors(candidate), ...existingAncestors(release), ...existingAncestors(report)])
    const reportExact = uniqueSorted(existingAncestors(report))
    const audits: Array<{ exactPaths: string[], recursiveRoots: string[], maxDepth: number, maxAuditEntries: number }> = []
    let beforePublishAuditIndex = -1
    const { buildVisualPrivacyManifest } = await import(modulePath)

    await buildVisualPrivacyManifest({
      candidateRoot: candidate,
      releaseRoot: release,
      reportPath: report,
      reparseAudit: (request: { exactPaths: string[], recursiveRoots: string[], maxDepth: number, maxAuditEntries: number }) => {
        audits.push(request)
        if (audits.length === 3) expect(beforePublishAuditIndex).toBe(2)
      },
      beforePublish: () => {
        expect(audits).toHaveLength(2)
        beforePublishAuditIndex = audits.length
      }
    })

    expect(audits).toHaveLength(3)
    expect(beforePublishAuditIndex).toBe(2)
    expect(audits).toEqual([
      { exactPaths: phaseOneExact, recursiveRoots: uniqueSorted([candidate, release]), maxDepth: 20, maxAuditEntries: 10_000 },
      { exactPaths: reportExact, recursiveRoots: [], maxDepth: 20, maxAuditEntries: 10_000 },
      { exactPaths: reportExact, recursiveRoots: uniqueSorted([candidate, release]), maxDepth: 20, maxAuditEntries: 10_000 }
    ])
  })

  it('passes configured audit traversal limits to every audit phase', async () => {
    const root = mkdtempSync(join(tmpdir(), 'visual-privacy-audit-limits-'))
    roots.push(root)
    const candidate = join(root, 'candidate')
    const release = join(root, 'release')
    const report = join(root, 'report', 'visuals.json')
    mkdirSync(candidate, { recursive: true })
    mkdirSync(release, { recursive: true })
    const requests: Array<{ maxDepth: number, maxAuditEntries: number }> = []
    const { buildVisualPrivacyManifest } = await import(modulePath)

    await buildVisualPrivacyManifest({
      candidateRoot: candidate,
      releaseRoot: release,
      reportPath: report,
      limits: { maxDepth: 7, maxAuditEntries: 11 },
      reparseAudit: (request: { maxDepth: number, maxAuditEntries: number }) => requests.push(request)
    })

    expect(requests.map(({ maxDepth, maxAuditEntries }) => ({ maxDepth, maxAuditEntries }))).toEqual([
      { maxDepth: 7, maxAuditEntries: 11 },
      { maxDepth: 7, maxAuditEntries: 11 },
      { maxDepth: 7, maxAuditEntries: 11 }
    ])
  })

  it.each([2, 3])('rejects when batched reparse audit %s fails without publishing a report', async (failurePhase) => {
    const root = mkdtempSync(join(tmpdir(), 'visual-privacy-batched-audit-failure-'))
    roots.push(root)
    const candidate = join(root, 'candidate')
    const release = join(root, 'release')
    const report = join(root, 'report', 'visuals.json')
    mkdirSync(candidate, { recursive: true })
    mkdirSync(release, { recursive: true })
    let calls = 0
    const { buildVisualPrivacyManifest } = await import(modulePath)

    await expect(buildVisualPrivacyManifest({
      candidateRoot: candidate,
      releaseRoot: release,
      reportPath: report,
      reparseAudit: () => {
        calls += 1
        if (calls === failurePhase) throw new Error('REPARSE_POINT')
      }
    })).rejects.toThrow('VISUAL_PRIVACY_MANIFEST_INVALID')
    expect(calls).toBe(failurePhase)
    expect(existsSync(report)).toBe(false)
  })

  it.skipIf(process.platform !== 'win32')('rejects a nested candidate junction during the recursive audit', () => {
    const root = mkdtempSync(join(tmpdir(), 'visual-privacy-nested-junction-'))
    roots.push(root)
    const candidate = join(root, 'candidate')
    const release = join(root, 'release')
    const target = join(root, 'target')
    const report = join(root, 'report', 'visuals.json')
    mkdirSync(candidate, { recursive: true })
    mkdirSync(release, { recursive: true })
    mkdirSync(target, { recursive: true })
    symlinkSync(target, join(candidate, 'nested'), 'junction')

    const result = spawnSync(process.execPath, [script, '--candidate-root', candidate, '--release-root', release, '--report-path', report], {
      encoding: 'utf8'
    })

    expect(result.status).toBe(1)
    expect(existsSync(report)).toBe(false)
  })

  it('rejects a candidate directory replaced with a junction after the initial audit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'visual-privacy-walk-race-'))
    roots.push(root)
    const candidate = join(root, 'candidate')
    const release = join(root, 'release')
    const nested = join(candidate, 'nested')
    const target = join(root, 'target')
    const report = join(root, 'report', 'visuals.json')
    mkdirSync(nested, { recursive: true })
    mkdirSync(release, { recursive: true })
    mkdirSync(target, { recursive: true })
    writeFileSync(join(nested, 'cover.png'), Buffer.from([1]))
    const { buildVisualPrivacyManifest } = await import(modulePath)

    await expect(buildVisualPrivacyManifest({
      candidateRoot: candidate,
      releaseRoot: release,
      reportPath: report,
      afterInitialAudit: () => {
        rmSync(nested, { recursive: true, force: true })
        symlinkSync(target, nested, 'junction')
      }
    })).rejects.toThrow('VISUAL_PRIVACY_MANIFEST_INVALID')
    expect(existsSync(report)).toBe(false)
  })

  it.skipIf(process.platform !== 'win32')('uses stdin for the default PowerShell audit without PATH lookup', async () => {
    const source = readFileSync(script, 'utf8')
    const { auditReparsePoints } = await import(modulePath)
    const fakePowerShell = join(mkdtempSync(join(tmpdir(), 'visual-privacy-audit-fake-')), 'powershell.exe')
    roots.push(dirname(fakePowerShell))
    writeFileSync(fakePowerShell, 'not executed', 'utf8')
    let invocation: { executable: string, options: Record<string, unknown> } | undefined

    auditReparsePoints({ exactPaths: ['C:\\safe'], recursiveRoots: [], maxDepth: 1, maxAuditEntries: 2 }, {
      powershellPath: fakePowerShell,
      spawn: (executable: string, _args: string[], options: Record<string, unknown>) => {
        invocation = { executable, options }
        return { status: 0 }
      }
    })

    expect(source).toContain("join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')")
    expect(source).toContain('$json = [Console]::In.ReadToEnd()')
    expect(source).toContain('Get-ChildItem -LiteralPath $current.Path -Force -ErrorAction Stop | ForEach-Object')
    expect(source).not.toContain('$entries = Get-ChildItem')
    expect(source).toContain('opendirSync')
    expect(source).not.toContain('readdirSync')
    expect(invocation?.executable).toBe(fakePowerShell)
    expect(invocation?.options.input).toBe(JSON.stringify({ exactPaths: ['C:\\safe'], recursiveRoots: [], maxDepth: 1, maxAuditEntries: 2 }))
    expect(Object.keys((invocation?.options.env ?? {}) as Record<string, string>).sort()).toEqual(['ComSpec', 'SystemRoot', 'TEMP', 'TMP'].filter((name) => process.env[name] !== undefined || name === 'SystemRoot').sort())
  })

  it.skipIf(process.platform !== 'win32')('rejects a nested junction even when PATH contains a successful fake powershell.exe', () => {
    const root = mkdtempSync(join(tmpdir(), 'visual-privacy-poisoned-path-'))
    roots.push(root)
    const candidate = join(root, 'candidate')
    const release = join(root, 'release')
    const target = join(root, 'target')
    const report = join(root, 'report', 'visuals.json')
    const fakeDirectory = join(root, 'fake-bin')
    const fakePowerShell = join(fakeDirectory, 'powershell.exe')
    const fakeSource = join(fakeDirectory, 'fake-powershell.cs')
    const marker = join(root, 'fake-was-run')
    const csc = join(process.env.SystemRoot!, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
    mkdirSync(candidate, { recursive: true })
    mkdirSync(release, { recursive: true })
    mkdirSync(target, { recursive: true })
    mkdirSync(fakeDirectory, { recursive: true })
    symlinkSync(target, join(candidate, 'nested'), 'junction')
    writeFileSync(fakeSource, `using System.IO; class Program { static int Main() { File.WriteAllText(${JSON.stringify(marker)}, \"called\"); return 0; } }`, 'utf8')
    const compile = spawnSync(csc, ['/nologo', '/target:exe', `/out:${fakePowerShell}`, fakeSource], { encoding: 'utf8' })
    expect(compile.status).toBe(0)

    const result = spawnSync(process.execPath, [script, '--candidate-root', candidate, '--release-root', release, '--report-path', report], {
      encoding: 'utf8',
      env: { ...process.env, PATH: fakeDirectory }
    })

    expect(result.status).toBe(1)
    expect(existsSync(marker)).toBe(false)
    expect(existsSync(report)).toBe(false)
  })

  it.skipIf(process.platform !== 'win32')('rejects default-audit traversal depth and entry limits before publishing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'visual-privacy-default-audit-limits-'))
    roots.push(root)
    const { buildVisualPrivacyManifest } = await import(modulePath)
    const cases = [
      { name: 'entries', limits: { maxAuditEntries: 1 }, setup: (candidate: string) => { writeFileSync(join(candidate, 'a.txt'), 'a'); writeFileSync(join(candidate, 'b.txt'), 'b') } },
      { name: 'depth', limits: { maxDepth: 0 }, setup: (candidate: string) => { mkdirSync(join(candidate, 'nested'), { recursive: true }) } }
    ]

    for (const testCase of cases) {
      const candidate = join(root, `${testCase.name}-candidate`)
      const release = join(root, `${testCase.name}-release`)
      const report = join(root, `${testCase.name}-report`, 'visuals.json')
      mkdirSync(candidate, { recursive: true })
      mkdirSync(release, { recursive: true })
      testCase.setup(candidate)
      await expect(buildVisualPrivacyManifest({ candidateRoot: candidate, releaseRoot: release, reportPath: report, limits: testCase.limits }))
        .rejects.toThrow('VISUAL_PRIVACY_MANIFEST_INVALID')
      expect(existsSync(report)).toBe(false)
    }
  })

  it('rejects a report-parent junction race before publication', async () => {
    const root = mkdtempSync(join(tmpdir(), 'visual-privacy-race-'))
    roots.push(root)
    const candidate = join(root, 'candidate')
    const release = join(root, 'release')
    const reportParent = join(root, 'report')
    const target = join(root, 'target')
    const report = join(reportParent, 'visuals.json')
    mkdirSync(candidate, { recursive: true })
    mkdirSync(release, { recursive: true })
    mkdirSync(target, { recursive: true })
    writeFileSync(join(candidate, 'cover.png'), Buffer.from([1]))
    const { buildVisualPrivacyManifest } = await import(modulePath)

    await expect(buildVisualPrivacyManifest({
      candidateRoot: candidate,
      releaseRoot: release,
      reportPath: report,
      beforePublish: () => {
        rmSync(reportParent, { recursive: true, force: true })
        symlinkSync(target, reportParent, 'junction')
      }
    })).rejects.toThrow('VISUAL_PRIVACY_MANIFEST_INVALID')
    expect(existsSync(report)).toBe(false)
    expect(existsSync(join(target, 'visuals.json'))).toBe(false)
  })

  it('does not overwrite a report created immediately before the atomic link', async () => {
    const root = mkdtempSync(join(tmpdir(), 'visual-privacy-publish-race-'))
    roots.push(root)
    const candidate = join(root, 'candidate')
    const release = join(root, 'release')
    const report = join(root, 'report', 'visuals.json')
    mkdirSync(candidate, { recursive: true })
    mkdirSync(release, { recursive: true })
    writeFileSync(join(candidate, 'cover.png'), Buffer.from([1]))
    const { buildVisualPrivacyManifest } = await import(modulePath)

    await expect(buildVisualPrivacyManifest({
      candidateRoot: candidate,
      releaseRoot: release,
      reportPath: report,
      beforeLink: () => writeFileSync(report, 'competitor', 'utf8')
    })).rejects.toThrow('VISUAL_PRIVACY_MANIFEST_INVALID')
    expect(readFileSync(report, 'utf8')).toBe('competitor')
    expect(readdirSync(dirname(report)).some((name) => name.startsWith('.visual-privacy-'))).toBe(false)
  })
})
