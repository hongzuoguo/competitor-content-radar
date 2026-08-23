import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const verifierPath = resolve('scripts/verify-public-candidate.mjs')
const trustedPolicyPath = resolve('config/public-tree-allowlist.json')

async function createCandidate(files: Record<string, string | Buffer>, policy?: string | Buffer | null) {
  const root = await mkdtemp(join(tmpdir(), 'public-candidate-'))
  const candidatePolicy = policy === undefined ? await readFile(trustedPolicyPath) : policy
  if (candidatePolicy !== null) {
    await mkdir(join(root, 'config'), { recursive: true })
    await writeFile(join(root, 'config', 'public-tree-allowlist.json'), candidatePolicy)
  }
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
  return root
}

async function verifyCandidate(candidate: string) {
  const module = await import(`${verifierPath}?test=${Date.now()}-${Math.random()}`)
  return module.verifyPublicCandidate(candidate)
}

async function verifyWithTrustedPolicy(candidate: string, policy: string | Buffer) {
  const trustedRoot = await mkdtemp(join(tmpdir(), 'public-policy-'))
  const scriptPath = join(trustedRoot, 'scripts', 'verify-public-candidate.mjs')
  await mkdir(dirname(scriptPath), { recursive: true })
  await mkdir(join(trustedRoot, 'config'), { recursive: true })
  await writeFile(scriptPath, await readFile(verifierPath))
  await writeFile(join(trustedRoot, 'config', 'public-tree-allowlist.json'), policy)
  try {
    try {
      await execFileAsync(process.execPath, [scriptPath, '--candidate', candidate], { encoding: 'utf8', windowsHide: true })
      return []
    } catch (error) {
      return JSON.parse((error as { stdout: string }).stdout).errors
    }
  } finally {
    await rm(trustedRoot, { recursive: true, force: true })
  }
}

describe('public source candidate verification', () => {
  it('accepts allowed product paths and explicitly listed public documents', async () => {
    const candidate = await createCandidate({
      'src/main/index.ts': 'export const value = 1\n',
      'README.md': '# Public source\n',
      'CONTRIBUTING.md': '# Contributing\n',
      'THIRD_PARTY_NOTICES.md': '# Notices\n',
      '.gitleaks.toml': 'title = "Public scan"\n',
      '.gitleaksignore': 'tests/example.test.ts:generic-api-key:1\n',
      'docs/operations/README.md': '# Operations\n',
      'docs/operations/electron-preview.md': '# Preview\n',
      'docs/resources-and-licenses.md': '# Resources\n',
      'docs/2026-08-06-user-guide.md': '# User guide\n',
    })
    try {
      await expect(verifyCandidate(candidate)).resolves.toEqual([])
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it.each([
    ['private plans', 'docs/superpowers/plan.md', 'docs/superpowers', 'PRIVATE_INTERNAL_DOCUMENTATION'],
    ['Feishu instructions', 'docs/operations/feishu-readonly-analysis.md', undefined, 'PRIVATE_INTERNAL_DOCUMENTATION'],
    ['history cleanup script', 'scripts/archive-and-clean-history.ps1', undefined, 'PRIVATE_INTERNAL_DOCUMENTATION'],
    ['history cleanup test', 'tests/build/archive-clean-history.test.ts', undefined, 'PRIVATE_INTERNAL_DOCUMENTATION'],
    ['tool state', '.codex/state.json', '.codex', 'PRIVATE_TOOL_STATE'],
    ['unknown root file', 'notes.txt', undefined, 'PATH_NOT_ALLOWLISTED'],
    ['production environment', '.env.production', undefined, 'PRIVATE_ENVIRONMENT_FILE'],
    ['release environment', '.env.release', undefined, 'PRIVATE_ENVIRONMENT_FILE'],
    ['database', 'data/cache.db', undefined, 'DATABASE_ARTIFACT'],
    ['log', 'logs/build.log', undefined, 'MEDIA_OR_MODEL_ARTIFACT'],
    ['media', 'media/demo.mp4', undefined, 'MEDIA_OR_MODEL_ARTIFACT'],
    ['model', 'resources/model.onnx', undefined, 'MEDIA_OR_MODEL_ARTIFACT'],
    ['release output', 'release/app.txt', 'release', 'BUILD_ARTIFACT'],
    ['build output', 'out/main.js', 'out', 'BUILD_ARTIFACT'],
    ['dependencies', 'node_modules/example/index.js', 'node_modules', 'BUILD_ARTIFACT'],
    ['private release note', 'docs/releases/0.3.1.md', undefined, 'PATH_NOT_ALLOWLISTED'],
  ])('rejects %s without returning file content', async (_label, relativePath, expectedRelativePath = relativePath, expectedRuleId) => {
    const sentinel = 'DO_NOT_ECHO_PRIVATE_CONTENT_7c1459'
    const candidate = await createCandidate({ [relativePath]: sentinel })
    try {
      const errors = await verifyCandidate(candidate)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({ ruleId: expectedRuleId, relativePath: expectedRelativePath })
      expect(errors[0].fileSha256).toBeNull()
      expect(JSON.stringify(errors)).not.toContain(sentinel)
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it.each([
    ['tampered', '{"version":1,"allowedPaths":["**"]}'],
    ['malformed', 'DO_NOT_ECHO_TAMPERED_POLICY_5c7b19'],
    ['missing', null],
  ])('rejects a %s candidate policy without returning it', async (_label, policy) => {
    const candidate = await createCandidate({ 'README.md': '# source\n' }, policy)
    try {
      const errors = await verifyCandidate(candidate)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({ ruleId: 'ALLOWLIST_POLICY_MISMATCH', relativePath: 'config/public-tree-allowlist.json' })
      if (policy !== null) expect(JSON.stringify(errors)).not.toContain(policy)
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it('accepts a candidate allowlist whose only difference is CRLF line endings', async () => {
    const trustedPolicy = await readFile(trustedPolicyPath, 'utf8')
    const candidate = await createCandidate({ 'README.md': '# source\n' }, trustedPolicy.replace(/\r?\n/g, '\r\n'))
    try {
      await expect(verifyCandidate(candidate)).resolves.toEqual([])
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it.each([
    ['whitespace tampering', (policy: string) => policy.replace('"version": 1', '"version":  1')],
    ['an isolated carriage return', (policy: string) => policy.replace('\n', '\r')],
  ])('rejects candidate policy with %s', async (_label, transform) => {
    const trustedPolicy = await readFile(trustedPolicyPath, 'utf8')
    const candidate = await createCandidate({ 'README.md': '# source\n' }, transform(trustedPolicy))
    try {
      await expect(verifyCandidate(candidate)).resolves.toMatchObject([
        { ruleId: 'ALLOWLIST_POLICY_MISMATCH', relativePath: 'config/public-tree-allowlist.json' },
      ])
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it('rejects an oversized candidate policy before reading it', async () => {
    const trustedPolicy = await readFile(trustedPolicyPath, 'utf8')
    const oversizedPolicy = `${trustedPolicy}DO_NOT_READ_OVERSIZED_POLICY`
    const candidate = await createCandidate({ 'README.md': '# source\n' }, oversizedPolicy)
    let readAttempted = false
    try {
      const module = await import(`${verifierPath}?test=${Date.now()}-${Math.random()}`)
      await expect(module.verifyPublicCandidate(candidate, {
        beforeCandidatePolicyRead: async () => { readAttempted = true },
      })).resolves.toEqual([
        { ruleId: 'ALLOWLIST_POLICY_MISMATCH', relativePath: 'config/public-tree-allowlist.json', fileSha256: null },
      ])
      expect(readAttempted).toBe(false)
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it.each(['.env.production', '.env.release'])('rejects an empty %s file', async (relativePath) => {
    const candidate = await createCandidate({ [relativePath]: '' })
    try {
      await expect(verifyCandidate(candidate)).resolves.toEqual([
        { ruleId: 'PRIVATE_ENVIRONMENT_FILE', relativePath, fileSha256: null },
      ])
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it.each([
    ['binary file', 'resources/secret.bin'],
    ['extensionless private key', 'src/.ssh/id_rsa'],
    ['dotfile', 'src/.private'],
  ])('rejects an unallowlisted %s without reading it', async (_label, relativePath) => {
    const candidate = await createCandidate({ [relativePath]: 'DO_NOT_READ_51e8' })
    try {
      await expect(verifyCandidate(candidate)).resolves.toEqual([
        { ruleId: 'PATH_NOT_ALLOWLISTED', relativePath, fileSha256: null },
      ])
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it('rejects UTF-16 content in an allowed text path', async () => {
    const candidate = await createCandidate({ 'src/main/utf16.ts': Buffer.from([0xff, 0xfe, 0x61, 0x00]) })
    try {
      await expect(verifyCandidate(candidate)).resolves.toMatchObject([
        { ruleId: 'TEXT_ENCODING_INVALID', relativePath: 'src/main/utf16.ts' },
      ])
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it('accepts clean UTF-8 BOM content in an allowed text path', async () => {
    const candidate = await createCandidate({ 'src/main/utf8-bom.ts': Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('export {}\n')]) })
    try {
      await expect(verifyCandidate(candidate)).resolves.toEqual([])
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it('scans UTF-8 BOM content for private markers', async () => {
    const marker = Buffer.from('YmlsbGluZw==', 'base64').toString('utf8')
    const candidate = await createCandidate({ 'src/main/utf8-bom-marker.ts': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(marker)]) })
    try {
      await expect(verifyCandidate(candidate)).resolves.toMatchObject([
        { ruleId: 'PRIVATE_BILLING_REFERENCE', relativePath: 'src/main/utf8-bom-marker.ts' },
      ])
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it('rejects a candidate under a reparse-point ancestor', async () => {
    const candidate = await createCandidate({ 'README.md': '# source\n' })
    const linkedParent = await mkdtemp(join(tmpdir(), 'public-candidate-parent-'))
    const link = join(linkedParent, 'candidate-parent')
    try {
      await symlink(dirname(candidate), link, 'junction')
      await expect(verifyCandidate(join(link, basename(candidate)))).resolves.toEqual([
        { ruleId: 'CANDIDATE_ANCESTOR_REPARSE_POINT', relativePath: '.', fileSha256: null },
      ])
    } finally {
      await rm(linkedParent, { recursive: true, force: true })
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it('rejects a file that exceeds the trusted maximum size before reading it', async () => {
    const candidate = await createCandidate({ 'src/main/large.ts': '' })
    try {
      await truncate(join(candidate, 'src', 'main', 'large.ts'), 33_554_433)
      await expect(verifyCandidate(candidate)).resolves.toEqual([
        { ruleId: 'MAX_FILE_BYTES_EXCEEDED', relativePath: 'src/main/large.ts', fileSha256: null },
      ])
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it('detects a prohibited file added while a directory child is scanned', async () => {
    const candidate = await createCandidate({ 'src/main/index.ts': 'export {}\n' })
    try {
      const module = await import(`${verifierPath}?test=${Date.now()}-${Math.random()}`)
      const errors = await module.verifyPublicCandidate(candidate, {
        beforeFileOpen: async (path: string) => {
          if (path.endsWith('index.ts')) await writeFile(join(candidate, 'src', '.private'), 'DO_NOT_ECHO_ADDED_FILE')
        },
      })
      expect(errors).toContainEqual({ ruleId: 'CANDIDATE_CHANGED_DURING_SCAN', relativePath: 'src', fileSha256: null })
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it('detects a file added to the root while a child is scanned', async () => {
    const candidate = await createCandidate({ 'src/main/index.ts': 'export {}\n' })
    try {
      const module = await import(`${verifierPath}?test=${Date.now()}-${Math.random()}`)
      const errors = await module.verifyPublicCandidate(candidate, {
        beforeFileOpen: async (path: string) => {
          if (path.endsWith('index.ts')) await writeFile(join(candidate, 'notes.txt'), 'DO_NOT_ECHO_ROOT_ADDITION')
        },
      })
      expect(errors).toEqual([{ ruleId: 'CANDIDATE_CHANGED_DURING_SCAN', relativePath: '.', fileSha256: null }])
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it('detects an append after a file handle is verified without reading appended bytes', async () => {
    const candidate = await createCandidate({ 'src/main/index.ts': 'export {}\n' })
    const secret = 'DO_NOT_ECHO_APPENDED_BYTES'
    try {
      const module = await import(`${verifierPath}?test=${Date.now()}-${Math.random()}`)
      const errors = await module.verifyPublicCandidate(candidate, {
        afterFileHandleStat: async (path: string) => {
          if (path.endsWith('index.ts')) await writeFile(path, secret, { flag: 'a' })
        },
      })
      expect(errors).toContainEqual({ ruleId: 'CANDIDATE_CHANGED_DURING_SCAN', relativePath: 'src/main/index.ts', fileSha256: null })
      expect(JSON.stringify(errors)).not.toContain(secret)
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it('detects a file replacement before opening its handle without reading it', async () => {
    const candidate = await createCandidate({ 'src/main/index.ts': 'export {}\n' })
    try {
      const module = await import(`${verifierPath}?test=${Date.now()}-${Math.random()}`)
      const secret = 'DO_NOT_ECHO_REPLACED_FILE'
      const errors = await module.verifyPublicCandidate(candidate, {
        beforeFileOpen: async (path: string) => {
          if (path.endsWith('index.ts')) await writeFile(path, secret.repeat(20))
        },
      })
      expect(errors).toContainEqual({ ruleId: 'CANDIDATE_CHANGED_DURING_SCAN', relativePath: 'src/main/index.ts', fileSha256: null })
      expect(JSON.stringify(errors)).not.toContain(secret)
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it('rejects unknown fields and invalid limits in the trusted policy', async () => {
    const invalidPolicy = JSON.stringify({ version: 1, allowedPaths: [], deniedPaths: [], contentRules: [], binaryPaths: [], limits: {}, extra: true })
    const candidate = await createCandidate({ 'README.md': '# source\n' }, invalidPolicy)
    try {
      await expect(verifyWithTrustedPolicy(candidate, invalidPolicy)).resolves.toEqual([
        { ruleId: 'TRUSTED_ALLOWLIST_INVALID', relativePath: 'config/public-tree-allowlist.json', fileSha256: null },
      ])
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it.each([
    ['YmlsbGluZw==', 'PRIVATE_BILLING_REFERENCE'],
    ['TUFJTl9WSVRFX0JJTExJTkc=', 'PRIVATE_BILLING_REFERENCE'],
    ['dmVyaWZ5OmJpbGxpbmc=', 'PRIVATE_BILLING_REFERENCE'],
    ['aG9uZ3p1b2d1by9oaXRtdXNlLXByaXZhdGUtcmVzb3VyY2Vz', 'PRIVATE_RESOURCE_REPOSITORY'],
    ['aG9uZ3p1b2d1by9jb21wZXRpdG9yLWNvbnRlbnQtcmFkYXItcmVsZWFzZXM=', 'PRIVATE_RELEASE_REPOSITORY'],
    ['RTpcMTA1MDA=', 'PRIVATE_WORKSTATION_PATH'],
    ['QzpcVXNlcnNcMTA1MDA=', 'PRIVATE_WORKSTATION_PATH'],
  ].map(([encodedMarker, ruleId]) => [Buffer.from(encodedMarker, 'base64').toString('utf8'), ruleId]))('rejects a private content marker without returning it', async (marker, expectedRuleId) => {
    const candidate = await createCandidate({ 'src/main/index.ts': `const marker = '${marker}'\n` })
    try {
      const errors = await verifyCandidate(candidate)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({ ruleId: expectedRuleId, relativePath: 'src/main/index.ts' })
      expect(JSON.stringify(errors)).not.toContain(marker)
    } finally {
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it('rejects a reparse-point candidate entry without following it', async () => {
    const candidate = await createCandidate({})
    const external = await mkdtemp(join(tmpdir(), 'public-candidate-external-'))
    await writeFile(join(external, 'secret.txt'), 'DO_NOT_FOLLOW_THIS_CONTENT', 'utf8')
    try {
      await symlink(external, join(candidate, 'src-link'), 'junction')
      const errors = await verifyCandidate(candidate)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({ ruleId: 'REPARSE_POINT', relativePath: 'src-link', fileSha256: null })
      expect(JSON.stringify(errors)).not.toContain('DO_NOT_FOLLOW_THIS_CONTENT')
    } finally {
      await rm(candidate, { recursive: true, force: true })
      await rm(external, { recursive: true, force: true })
    }
  })

  it('rejects a reparse-point candidate root', async () => {
    const candidate = await createCandidate({ 'README.md': '# source\n' })
    const parent = await mkdtemp(join(tmpdir(), 'public-candidate-root-'))
    const link = join(parent, 'candidate-link')
    try {
      await symlink(candidate, link, 'junction')
      await expect(verifyCandidate(link)).resolves.toEqual([
        { ruleId: 'CANDIDATE_ROOT_REPARSE_POINT', relativePath: '.', fileSha256: null },
      ])
    } finally {
      await rm(parent, { recursive: true, force: true })
      await rm(candidate, { recursive: true, force: true })
    }
  })

  it('rejects a relative CLI candidate with sanitized JSON output', async () => {
    await expect(execFileAsync(process.execPath, [verifierPath, '--candidate', '.'], {
      cwd: process.cwd(), encoding: 'utf8', windowsHide: true,
    })).rejects.toMatchObject({
      stdout: expect.stringMatching(/^\{"errors":\[\{"ruleId":"CANDIDATE_PATH_NOT_ABSOLUTE","relativePath":"\.","fileSha256":null}\]\}\r?\n?$/),
    })
  })
})
