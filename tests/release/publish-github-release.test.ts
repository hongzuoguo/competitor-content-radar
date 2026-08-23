import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { publishGitHubRelease } from '../../scripts/publish-github-release.mjs'

const repository = 'hongzuoguo/competitor-content-radar'
const releaseVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version
const tag = `v${releaseVersion}`
const commit = 'a'.repeat(40)

function digest(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex')
}

type Asset = { path: string, name: string, bytes: Buffer, sha256: string }

async function updateManifestAsset(evidence: string, path: string) {
  const manifest = join(evidence, 'assets-manifest.json')
  const value = JSON.parse(await readFile(manifest, 'utf8'))
  const bytes = await readFile(join(evidence, path))
  const asset = value.assets.find((entry: { path: string }) => entry.path === path)
  asset.bytes = bytes.length
  asset.sha256 = digest(bytes)
  await writeFile(manifest, JSON.stringify(value, null, 2))
}

async function withEvidence(run: (fixture: { evidence: string, manifest: string, assets: Asset[] }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'hitmuse-publish-release-'))
  const evidence = join(root, 'evidence')
  const sourceAssets = [
    { name: `HitMuse-${releaseVersion}-aaaaaaa-setup.exe`, bytes: Buffer.from('installer') },
    { name: 'latest.yml', bytes: Buffer.from(`version: ${releaseVersion}\n`) }
  ].map((asset) => ({ path: asset.name, ...asset, sha256: digest(asset.bytes) }))
  try {
    await mkdir(evidence)
    for (const asset of sourceAssets) await writeFile(join(evidence, asset.path), asset.bytes)
    const artifactCount = 6
    await writeFile(join(evidence, 'build-manifest.json'), JSON.stringify({ schemaVersion: 1, status: 'PASSED', commit, version: releaseVersion, artifactCount }))
    await writeFile(join(evidence, 'acceptance.log'), `status=PASSED commit=${commit} version=${releaseVersion} artifacts=${artifactCount}\n`)
    const generatedPaths = ['acceptance.log', 'build-manifest.json']
    const shaRows = [...sourceAssets.map((asset) => ({ path: asset.path, bytes: asset.bytes, sha256: asset.sha256 })), ...await Promise.all(generatedPaths.map(async (path) => {
      const bytes = await readFile(join(evidence, path))
      return { path, bytes, sha256: digest(bytes) }
    }))].sort((left, right) => `${left.sha256}  ${left.path}`.localeCompare(`${right.sha256}  ${right.path}`))
    await writeFile(join(evidence, 'SHA256SUMS.txt'), `${shaRows.map((asset) => `${asset.sha256}  ${asset.path}`).join('\n')}\n`)
    const shaSumsBytes = await readFile(join(evidence, 'SHA256SUMS.txt'))
    const checksumFiles = [
      ...sourceAssets.map(({ path, bytes, sha256 }) => ({ path, bytes: bytes.length, sha256, status: 'VERIFIED' })),
      ...shaRows.filter((asset) => generatedPaths.includes(asset.path)).map(({ path, bytes, sha256 }) => ({ path, bytes: bytes.length, sha256, status: 'GENERATED' })),
      { path: 'SHA256SUMS.txt', bytes: shaSumsBytes.length, sha256: digest(shaSumsBytes), status: 'GENERATED' },
      { path: 'checksums.json', bytes: 0, sha256: null, status: 'SELF_EXCLUDED' }
    ].sort((left, right) => left.path.localeCompare(right.path))
    let checksumsBytes: Buffer
    for (;;) {
      checksumsBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, status: 'PASSED', commit, version: releaseVersion, selfHashConvention: 'test self exclusion', files: checksumFiles }, null, 2)}\n`)
      const self = checksumFiles.find((entry) => entry.path === 'checksums.json')!
      if (self.bytes === checksumsBytes.length) break
      self.bytes = checksumsBytes.length
    }
    await writeFile(join(evidence, 'checksums.json'), checksumsBytes)
    const assets: Asset[] = [
      ...sourceAssets,
      ...await Promise.all(['acceptance.log', 'build-manifest.json', 'SHA256SUMS.txt', 'checksums.json'].map(async (path) => {
        const bytes = await readFile(join(evidence, path))
        return { path, name: path, bytes, sha256: digest(bytes) }
      }))
    ].sort((left, right) => left.path.localeCompare(right.path))
    const manifest = join(evidence, 'assets-manifest.json')
    await writeFile(manifest, JSON.stringify({
      schemaVersion: 1, commit, version: releaseVersion,
      assets: assets.map(({ path, name, bytes, sha256 }) => ({ path, name, bytes: bytes.length, sha256 }))
    }, null, 2))
    await run({ evidence, manifest, assets })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function responseJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function releaseApi(options: { tagTarget?: string, annotatedTag?: boolean, existingRelease?: boolean, uploadName?: string, downloadBytes?: Buffer, deleteFails?: boolean, onFirstRequest?: () => Promise<void> | void } = {}) {
  const requests: Array<{ url: string, method: string, body?: string, authorization: string | null }> = []
  let created = false
  const uploaded: Array<{ id: number, name: string, bytes: Buffer }> = []
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    if (requests.length === 0) await options.onFirstRequest?.()
    requests.push({ url, method, body: typeof init.body === 'string' ? init.body : undefined, authorization: new Headers(init.headers).get('authorization') })
    if (url.endsWith(`/git/ref/tags/${tag}`)) return responseJson({ object: { type: options.annotatedTag ? 'tag' : 'commit', sha: options.annotatedTag ? 'c'.repeat(40) : options.tagTarget ?? commit } })
    if (url.endsWith(`/git/tags/${'c'.repeat(40)}`)) return responseJson({ object: { type: 'commit', sha: options.tagTarget ?? commit } })
    if (url.endsWith(`/releases/tags/${tag}`)) return options.existingRelease ? responseJson({ id: 8 }) : responseJson({ message: 'Not Found' }, 404)
    if (url.endsWith('/releases') && method === 'POST') { created = true; return responseJson({ id: 41 }, 201) }
    if (url.includes('/releases/41/assets?name=') && method === 'POST') {
      const name = decodeURIComponent(url.slice(url.lastIndexOf('=') + 1))
      if (options.uploadName && name === options.uploadName) return responseJson({ message: 'upload interrupted' }, 500)
      const asset = { id: uploaded.length + 1, name, bytes: Buffer.from(init.body as Buffer) }
      uploaded.push(asset)
      return responseJson({ id: asset.id, name: asset.name }, 201)
    }
    if (url.endsWith('/releases/41/assets?per_page=100')) return responseJson(uploaded.map(({ id, name }) => ({ id, name })))
    const assetMatch = url.match(/\/releases\/assets\/(\d+)$/)
    if (assetMatch) return new Response(options.downloadBytes ?? uploaded[Number(assetMatch[1]) - 1].bytes, { status: 200 })
    if (url.endsWith('/releases/41') && method === 'PATCH') return responseJson({ id: 41, draft: false })
    if (url.endsWith('/releases/41') && method === 'DELETE') return options.deleteFails ? responseJson({ message: 'delete failed' }, 500) : new Response(null, { status: 204 })
    throw new Error(`unexpected request ${method} ${url}`)
  }
  return { fetch, requests, uploaded, get created() { return created } }
}

describe('publishGitHubRelease', () => {
  it('creates a draft, verifies every uploaded asset, and only then publishes it', async () => {
    await withEvidence(async ({ evidence, manifest, assets }) => {
      const api = releaseApi()
      await expect(publishGitHubRelease({ repository, tag, commit, assetsManifest: manifest, evidenceDirectory: evidence, environment: { GITHUB_TOKEN: 'runtime-token' }, fetch: api.fetch })).resolves.toEqual({ status: 'PUBLISHED', repository, tag, commit, assets: assets.length })
      const create = api.requests.findIndex((request) => request.url.endsWith('/releases') && request.method === 'POST')
      const verify = api.requests.findIndex((request) => request.url.endsWith('/releases/assets/1'))
      const publish = api.requests.findIndex((request) => request.url.endsWith('/releases/41') && request.method === 'PATCH')
      expect(create).toBeGreaterThan(-1)
      expect(verify).toBeGreaterThan(create)
      expect(publish).toBeGreaterThan(verify)
      expect(api.requests[create].body).toBe(JSON.stringify({ tag_name: tag, target_commitish: commit, draft: true, prerelease: false }))
      expect(api.requests.every((request) => !request.url.includes('runtime-token'))).toBe(true)
    })
  })

  it('authenticates lightweight and annotated tag lookups without exposing the token', async () => {
    await withEvidence(async ({ evidence, manifest }) => {
      const api = releaseApi({ annotatedTag: true })
      await expect(publishGitHubRelease({ repository, tag, commit, assetsManifest: manifest, evidenceDirectory: evidence, environment: { GITHUB_TOKEN: 'test-token' }, fetch: api.fetch })).resolves.toMatchObject({ status: 'PUBLISHED' })
      const tagLookups = api.requests.filter((request) => request.url.includes('/git/ref/tags/') || request.url.includes('/git/tags/'))
      expect(tagLookups).toHaveLength(2)
      expect(tagLookups.every((request) => request.authorization === 'Bearer test-token' && !request.url.includes('test-token') && request.body === undefined)).toBe(true)
    })
  })

  it('uploads preflight-verified bytes when a local asset changes after REST begins', async () => {
    await withEvidence(async ({ evidence, manifest, assets }) => {
      const original = Buffer.from(assets[0].bytes)
      const api = releaseApi({ onFirstRequest: () => writeFile(join(evidence, assets[0].name), 'tampered after preflight') })
      await expect(publishGitHubRelease({ repository, tag, commit, assetsManifest: manifest, evidenceDirectory: evidence, environment: { GITHUB_TOKEN: 'runtime-token' }, fetch: api.fetch })).resolves.toMatchObject({ status: 'PUBLISHED' })
      expect(api.requests.some((request) => request.url.includes('runtime-token') || request.body?.includes('runtime-token'))).toBe(false)
      expect(api.uploaded.find((asset) => asset.name === assets[0].name)?.bytes).toEqual(original)
    })
  })

  it.each([
    ['a real asset despite updating only assets-manifest', async (evidence: string) => { await writeFile(join(evidence, 'latest.yml'), 'mutated\n'); await updateManifestAsset(evidence, 'latest.yml') }],
    ['a checksums row', async (evidence: string) => { const value = JSON.parse(await readFile(join(evidence, 'checksums.json'), 'utf8')); value.files[0].sha256 = '0'.repeat(64); await writeFile(join(evidence, 'checksums.json'), JSON.stringify(value)); await updateManifestAsset(evidence, 'checksums.json') }],
    ['a SHA256SUMS row', async (evidence: string) => { const path = join(evidence, 'SHA256SUMS.txt'); const text = await readFile(path, 'utf8'); await writeFile(path, `0${text.slice(1)}`); await updateManifestAsset(evidence, 'SHA256SUMS.txt') }],
    ['the build artifact count', async (evidence: string) => { const path = join(evidence, 'build-manifest.json'); const value = JSON.parse(await readFile(path, 'utf8')); value.artifactCount += 1; await writeFile(path, JSON.stringify(value)); await updateManifestAsset(evidence, 'build-manifest.json') }],
    ['the checksums self byte count', async (evidence: string) => { const path = join(evidence, 'checksums.json'); const value = JSON.parse(await readFile(path, 'utf8')); value.files.find((entry: { path: string }) => entry.path === 'checksums.json').bytes += 1; await writeFile(path, JSON.stringify(value)); await updateManifestAsset(evidence, 'checksums.json') }]
  ])('rejects %s before any network call', async (_name, tamper) => {
    await withEvidence(async ({ evidence, manifest }) => {
      await tamper(evidence)
      const api = releaseApi()
      await expect(publishGitHubRelease({ repository, tag, commit, assetsManifest: manifest, evidenceDirectory: evidence, environment: { GITHUB_TOKEN: 'runtime-token' }, fetch: api.fetch })).rejects.toThrow(/RELEASE_(ASSETS_MANIFEST|EVIDENCE)_INVALID/)
      expect(api.requests).toHaveLength(0)
    })
  })

  it.each([
    ['an existing release', releaseApi({ existingRelease: true }), 'RELEASE_ALREADY_EXISTS'],
    ['a tag pointing to another commit', releaseApi({ tagTarget: 'b'.repeat(40) }), 'RELEASE_TAG_COMMIT_MISMATCH']
  ])('refuses %s before creating a release', async (_name, api, code) => {
    await withEvidence(async ({ evidence, manifest }) => {
      await expect(publishGitHubRelease({ repository, tag, commit, assetsManifest: manifest, evidenceDirectory: evidence, environment: { GITHUB_TOKEN: 'runtime-token' }, fetch: api.fetch })).rejects.toThrow(code)
      expect(api.created).toBe(false)
    })
  })

  it('deletes only its created draft when an upload is interrupted', async () => {
    await withEvidence(async ({ evidence, manifest }) => {
      const api = releaseApi({ uploadName: 'latest.yml' })
      await expect(publishGitHubRelease({ repository, tag, commit, assetsManifest: manifest, evidenceDirectory: evidence, environment: { GITHUB_TOKEN: 'runtime-token' }, fetch: api.fetch })).rejects.toThrow('RELEASE_UPLOAD_FAILED')
      expect(api.requests.filter((request) => request.url.endsWith('/releases/41') && request.method === 'DELETE')).toHaveLength(1)
      expect(api.requests.some((request) => request.method === 'PATCH')).toBe(false)
    })
  })

  it('reports a blocked cleanup without creating a second release', async () => {
    await withEvidence(async ({ evidence, manifest }) => {
      const api = releaseApi({ uploadName: 'latest.yml', deleteFails: true })
      await expect(publishGitHubRelease({ repository, tag, commit, assetsManifest: manifest, evidenceDirectory: evidence, environment: { GITHUB_TOKEN: 'runtime-token' }, fetch: api.fetch })).rejects.toThrow('RELEASE_DRAFT_CLEANUP_BLOCKED')
      expect(api.requests.filter((request) => request.url.endsWith('/releases') && request.method === 'POST')).toHaveLength(1)
    })
  })

  it('deletes its draft when downloaded bytes do not match the manifest digest', async () => {
    await withEvidence(async ({ evidence, manifest }) => {
      const api = releaseApi({ downloadBytes: Buffer.from('tampered') })
      await expect(publishGitHubRelease({ repository, tag, commit, assetsManifest: manifest, evidenceDirectory: evidence, environment: { GITHUB_TOKEN: 'runtime-token' }, fetch: api.fetch })).rejects.toThrow('RELEASE_ASSET_DIGEST_MISMATCH')
      expect(api.requests.filter((request) => request.method === 'DELETE')).toHaveLength(1)
    })
  })
})
