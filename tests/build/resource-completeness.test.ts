import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const verifierPath = resolve('scripts/verify-resource-completeness.mjs')
const temporaryRoots: string[] = []

function definition(bytes: Buffer) {
  return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'hitmuse-resource-completeness-'))
  temporaryRoots.push(root)
  const engine = Buffer.from('engine')
  const model = Buffer.from('model')
  const icon = Buffer.from('icon')
  await mkdir(join(root, 'resources'), { recursive: true })
  await mkdir(join(root, '.build-resources', 'models', 'model-id'), { recursive: true })
  await mkdir(join(root, 'src', 'renderer', 'public'), { recursive: true })
  await mkdir(join(root, '.build-resources', 'scrapling-engine'), { recursive: true })
  await writeFile(join(root, '.build-resources', 'scrapling-engine', 'scrapling-engine-win32-x64.zip'), engine)
  await writeFile(join(root, '.build-resources', 'models', 'model-id', 'model.bin'), model)
  await writeFile(join(root, 'src', 'renderer', 'public', 'hitmuse-mark.png'), icon)
  const scraplingManifest = { sourceCommit: 'a'.repeat(40), archive: { filename: 'scrapling-engine-win32-x64.zip', ...definition(engine) } }
  const modelManifest = {
    id: 'model-id',
    displayName: 'Test model',
    upstream: { repository: 'owner/model', revision: 'a'.repeat(40), license: 'LicenseRef-Test', licenseUrl: `https://huggingface.co/owner/model/resolve/${'a'.repeat(40)}/LICENSE` },
    files: { 'model.bin': { url: `https://huggingface.co/owner/model/resolve/${'a'.repeat(40)}/model.bin`, ...definition(model) } }
  }
  await writeFile(join(root, '.build-resources', 'scrapling-engine', 'engine-manifest.json'), JSON.stringify(scraplingManifest))
  await writeFile(join(root, '.build-resources', 'scrapling-engine', 'engine-provenance.json'), JSON.stringify(scraplingManifest))
  await writeFile(join(root, 'resources', 'model-manifest.json'), JSON.stringify(modelManifest))
  const packageJson = { build: { extraResources: [
    { from: '.build-resources/scrapling-engine/scrapling-engine-win32-x64.zip', to: 'scrapling-engine/scrapling-engine-win32-x64.zip' },
    { from: '.build-resources/scrapling-engine/engine-manifest.json', to: 'scrapling-engine/manifest.json' },
    { from: '.build-resources/scrapling-engine/engine-provenance.json', to: 'scrapling-engine/engine-provenance.json' },
    { from: '.build-resources/models', to: 'models' },
    { from: 'src/renderer/public/hitmuse-mark.png', to: 'hitmuse-mark.png' }
  ] } }
  const trackedFiles = new Set([
    'resources/model-manifest.json',
    'src/renderer/public/hitmuse-mark.png'
  ])
  return { root, engine, packageJson, scraplingManifest, modelManifest, trackedFiles }
}

async function loadVerifier() {
  expect(existsSync(verifierPath), 'resource completeness verifier is required').toBe(true)
  const module = await import(`${pathToFileURL(verifierPath).href}?test=${Date.now()}-${Math.random()}`)
  return module.verifyResourceCompleteness as (options: Record<string, unknown>) => Promise<Record<string, any>>
}

async function loadVerifierModule() {
  return import(`${pathToFileURL(verifierPath).href}?test=${Date.now()}-${Math.random()}`)
}

function git(root: string, args: string[]) {
  execFileSync('git.exe', ['-C', root, ...args], { windowsHide: true })
}

async function createGitFixture() {
  const root = await mkdtemp(join(tmpdir(), 'hitmuse-resource-git-'))
  temporaryRoots.push(root)
  await writeFile(join(root, 'tracked.txt'), 'tracked\n')
  git(root, ['init'])
  git(root, ['config', 'user.name', 'HitMuse test'])
  git(root, ['config', 'user.email', 'tests@hitmuse.local'])
  git(root, ['add', 'tracked.txt'])
  git(root, ['commit', '-m', 'fixture'])
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('release resource completeness', () => {
  it('accepts a required tracked input with exact HEAD bytes', async () => {
    const root = await createGitFixture()
    const module = await loadVerifierModule()

    await expect(module.verifyTrackedInputsAtHead({ rootDirectory: root, inputs: ['tracked.txt'] })).resolves.toEqual(['tracked.txt'])
  })

  it('rejects a required tracked input modified in the working tree', async () => {
    const root = await createGitFixture()
    await writeFile(join(root, 'tracked.txt'), 'modified\n')
    const module = await loadVerifierModule()

    await expect(module.verifyTrackedInputsAtHead({ rootDirectory: root, inputs: ['tracked.txt'] }))
      .rejects.toThrow('RESOURCE_TRACKED_INPUT_DIRTY')
  })

  it('rejects a required tracked input modified in the index', async () => {
    const root = await createGitFixture()
    await writeFile(join(root, 'tracked.txt'), 'staged\n')
    git(root, ['add', 'tracked.txt'])
    const module = await loadVerifierModule()

    await expect(module.verifyTrackedInputsAtHead({ rootDirectory: root, inputs: ['tracked.txt'] }))
      .rejects.toThrow('RESOURCE_TRACKED_INPUT_DIRTY')
  })

  it('rejects a required input absent from the Git inventory', async () => {
    const root = await createGitFixture()
    await writeFile(join(root, 'untracked.txt'), 'untracked\n')
    const module = await loadVerifierModule()

    await expect(module.verifyTrackedInputsAtHead({ rootDirectory: root, inputs: ['untracked.txt'] }))
      .rejects.toThrow('RESOURCE_TRACKED_INPUT_NOT_GIT_TRACKED:untracked.txt')
  })

  it('binds production resource verification to the complete HEAD provenance input set', async () => {
    const source = await readFile(verifierPath, 'utf8')

    expect(source).toContain('await verifyTrackedInputsAtHead({ rootDirectory: root, trackedFiles, inputs: resourceTrackedInputs(extraResources, trackedFiles) })')
    expect(source).toContain("'scripts/prepare-model-resource.mjs'")
    expect(source).toContain('...sidecarBuildInputs')
  })

  it('proves every packaged resource from tracked manifests or current-checkout generated bytes', async () => {
    const fixture = await createFixture()
    const verify = await loadVerifier()

    const result = await verify({
      rootDirectory: fixture.root,
      packageJson: fixture.packageJson,
      modelManifest: fixture.modelManifest,
      trackedFiles: fixture.trackedFiles,
      sourceCommit: 'a'.repeat(40),
      verifyGeneratedScrapling: async () => fixture.scraplingManifest,
      verifyFfmpeg: async () => ({ size: 1, sha256: 'b'.repeat(64) })
    })

    expect(result.status).toBe('COMPLETE')
    expect(result.resources.map((resource: any) => resource.origin)).toEqual([
      'GENERATED', 'GENERATED', 'GENERATED', 'FETCHED', 'TRACKED', 'NODE_MODULE'
    ])
    expect(result.resources[0]).toMatchObject({ sha256: fixture.scraplingManifest.archive.sha256, size: fixture.engine.length })
  })

  it('rejects a tracked resource that is not in the selected commit', async () => {
    const fixture = await createFixture()
    fixture.trackedFiles.delete('src/renderer/public/hitmuse-mark.png')
    const verify = await loadVerifier()

    await expect(verify({
      rootDirectory: fixture.root,
      packageJson: fixture.packageJson,
      modelManifest: fixture.modelManifest,
      trackedFiles: fixture.trackedFiles,
      sourceCommit: 'a'.repeat(40),
      verifyGeneratedScrapling: async () => fixture.scraplingManifest,
      verifyFfmpeg: async () => ({ size: 1, sha256: 'b'.repeat(64) })
    })).rejects.toThrow('RESOURCE_NOT_GIT_TRACKED:src/renderer/public/hitmuse-mark.png')
  })

  it('rejects generated Scrapling bytes with the wrong hash', async () => {
    const fixture = await createFixture()
    await writeFile(join(fixture.root, '.build-resources', 'scrapling-engine', 'scrapling-engine-win32-x64.zip'), 'wrong')
    const verify = await loadVerifier()

    await expect(verify({
      rootDirectory: fixture.root,
      packageJson: fixture.packageJson,
      modelManifest: fixture.modelManifest,
      trackedFiles: fixture.trackedFiles,
      sourceCommit: 'a'.repeat(40),
      verifyGeneratedScrapling: async () => fixture.scraplingManifest,
      verifyFfmpeg: async () => ({ size: 1, sha256: 'b'.repeat(64) })
    })).rejects.toThrow('RESOURCE_SIZE_MISMATCH:.build-resources/scrapling-engine/scrapling-engine-win32-x64.zip')
  })

  it('reports a missing prepared model file after validating its path', async () => {
    const fixture = await createFixture()
    await rm(join(fixture.root, '.build-resources', 'models', 'model-id', 'model.bin'))
    const verify = await loadVerifier()

    await expect(verify({
      rootDirectory: fixture.root,
      packageJson: fixture.packageJson,
      modelManifest: fixture.modelManifest,
      trackedFiles: fixture.trackedFiles,
      sourceCommit: 'a'.repeat(40),
      verifyGeneratedScrapling: async () => fixture.scraplingManifest,
      verifyFfmpeg: async () => ({ size: 1, sha256: 'b'.repeat(64) })
    })).rejects.toThrow('RESOURCE_MISSING:.build-resources/models/model-id/model.bin')
  })

  it('rejects an extraResource outside the current checkout', async () => {
    const fixture = await createFixture()
    fixture.packageJson.build.extraResources.push({ from: '../outside.bin', to: 'outside.bin' })
    const verify = await loadVerifier()

    await expect(verify({
      rootDirectory: fixture.root,
      packageJson: fixture.packageJson,
      modelManifest: fixture.modelManifest,
      trackedFiles: fixture.trackedFiles,
      sourceCommit: 'a'.repeat(40),
      verifyGeneratedScrapling: async () => fixture.scraplingManifest,
      verifyFfmpeg: async () => ({ size: 1, sha256: 'b'.repeat(64) })
    })).rejects.toThrow('RESOURCE_PATH_OUTSIDE_CHECKOUT:../outside.bin')
  })

  it('rejects a mutable model URL before accepting prepared bytes', async () => {
    const fixture = await createFixture()
    fixture.modelManifest.files['model.bin'].url = 'https://huggingface.co/owner/model/resolve/main/model.bin'
    const verify = await loadVerifier()

    await expect(verify({
      rootDirectory: fixture.root,
      packageJson: fixture.packageJson,
      modelManifest: fixture.modelManifest,
      trackedFiles: fixture.trackedFiles,
      sourceCommit: 'a'.repeat(40),
      verifyGeneratedScrapling: async () => fixture.scraplingManifest,
      verifyFfmpeg: async () => ({ size: 1, sha256: 'b'.repeat(64) })
    })).rejects.toThrow('RESOURCE_MODEL_URL_INVALID:model.bin')
  })

  it.each([
    ['an empty display name', (manifest: any) => { manifest.displayName = '' }],
    ['a dot model id', (manifest: any) => { manifest.id = '..' }],
    ['a parent-directory model file', (manifest: any) => { manifest.files['../../outside.bin'] = manifest.files['model.bin']; delete manifest.files['model.bin'] }],
    ['a backslash model file', (manifest: any) => { manifest.files['nested\\model.bin'] = manifest.files['model.bin']; delete manifest.files['model.bin'] }]
  ])('rejects %s in the model manifest', async (_label, mutate) => {
    const fixture = await createFixture()
    mutate(fixture.modelManifest)
    const module = await loadVerifierModule()

    expect(() => module.validateModelManifest(fixture.modelManifest)).toThrow('RESOURCE_MODEL_MANIFEST_INVALID')
  })

  it('rejects an unsafe model root even when a matching file exists outside it', async () => {
    const fixture = await createFixture()
    fixture.modelManifest.id = '..'
    await writeFile(join(fixture.root, '.build-resources', 'model.bin'), 'model')
    const verify = await loadVerifier()

    await expect(verify({
      rootDirectory: fixture.root,
      packageJson: fixture.packageJson,
      modelManifest: fixture.modelManifest,
      trackedFiles: fixture.trackedFiles,
      sourceCommit: 'a'.repeat(40),
      verifyGeneratedScrapling: async () => fixture.scraplingManifest,
      verifyFfmpeg: async () => ({ size: 1, sha256: 'b'.repeat(64) })
    })).rejects.toThrow('RESOURCE_MODEL_MANIFEST_INVALID')
  })

  it('rejects a generated sidecar built from a different commit', async () => {
    const fixture = await createFixture()
    const verify = await loadVerifier()

    await expect(verify({
      rootDirectory: fixture.root,
      packageJson: fixture.packageJson,
      modelManifest: fixture.modelManifest,
      trackedFiles: fixture.trackedFiles,
      sourceCommit: 'a'.repeat(40),
      verifyGeneratedScrapling: async () => ({ ...fixture.scraplingManifest, sourceCommit: 'b'.repeat(40) }),
      verifyFfmpeg: async () => ({ size: 1, sha256: 'b'.repeat(64) })
    })).rejects.toThrow('RESOURCE_SCRAPLING_CURRENT_COMMIT_MISMATCH')
  })

  it('requires every generated sidecar member to be packaged', async () => {
    const fixture = await createFixture()
    fixture.packageJson.build.extraResources = fixture.packageJson.build.extraResources.filter((entry: { from: string }) => entry.from !== '.build-resources/scrapling-engine/engine-provenance.json')
    const verify = await loadVerifier()

    await expect(verify({
      rootDirectory: fixture.root,
      packageJson: fixture.packageJson,
      modelManifest: fixture.modelManifest,
      trackedFiles: fixture.trackedFiles,
      sourceCommit: 'a'.repeat(40),
      verifyGeneratedScrapling: async () => fixture.scraplingManifest,
      verifyFfmpeg: async () => ({ size: 1, sha256: 'b'.repeat(64) })
    })).rejects.toThrow('RESOURCE_SCRAPLING_CONFIGURATION_INVALID')
  })

  it.each([
    ['a duplicate destination', (fixture: any) => { fixture.packageJson.build.extraResources.push({ from: 'src/renderer/public/hitmuse-mark.png', to: 'scrapling-engine/manifest.json' }) }],
    ['a tracked file inside the model directory', (fixture: any) => { fixture.packageJson.build.extraResources.at(-1).to = 'models/model-id/model.bin' }],
    ['the model directory over the Scrapling directory', (fixture: any) => { fixture.packageJson.build.extraResources[3].to = 'scrapling-engine' }]
  ])('rejects %s', async (_label, mutate) => {
    const fixture = await createFixture()
    mutate(fixture)
    const verify = await loadVerifier()

    await expect(verify({
      rootDirectory: fixture.root,
      packageJson: fixture.packageJson,
      modelManifest: fixture.modelManifest,
      trackedFiles: fixture.trackedFiles,
      sourceCommit: 'a'.repeat(40),
      verifyGeneratedScrapling: async () => fixture.scraplingManifest,
      verifyFfmpeg: async () => ({ size: 1, sha256: 'b'.repeat(64) })
    })).rejects.toThrow('RESOURCE_DESTINATION_INVALID')
  })

  it.each([
    ['a case-insensitive directory ancestor', (fixture: any) => { fixture.packageJson.build.extraResources.at(-1).to = 'MODELS/model-id/model.bin' }],
    ['case-insensitive file duplicates', (fixture: any) => { fixture.packageJson.build.extraResources.at(-1).to = 'FOO.txt'; fixture.packageJson.build.extraResources.push({ from: 'src/renderer/public/hitmuse-mark.png', to: 'foo.txt' }) }],
    ['a file destination that is an ancestor of another file destination', (fixture: any) => { fixture.packageJson.build.extraResources.at(-1).to = 'runtime'; fixture.packageJson.build.extraResources.push({ from: 'src/renderer/public/hitmuse-mark.png', to: 'runtime/config.json' }) }]
  ])('rejects %s', async (_label, mutate) => {
    const fixture = await createFixture()
    mutate(fixture)
    const verify = await loadVerifier()

    await expect(verify({
      rootDirectory: fixture.root,
      packageJson: fixture.packageJson,
      modelManifest: fixture.modelManifest,
      trackedFiles: fixture.trackedFiles,
      sourceCommit: 'a'.repeat(40),
      verifyGeneratedScrapling: async () => fixture.scraplingManifest,
      verifyFfmpeg: async () => ({ size: 1, sha256: 'b'.repeat(64) })
    })).rejects.toThrow('RESOURCE_DESTINATION_INVALID')
  })

  it('rejects a non-regular FFmpeg package metadata file before reading it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hitmuse-ffmpeg-reparse-'))
    temporaryRoots.push(root)
    const packageDirectory = join(root, 'node_modules', 'ffmpeg-static')
    await mkdir(packageDirectory, { recursive: true })
    await mkdir(join(packageDirectory, 'package.json'))
    const manifest = JSON.parse(await readFile(resolve('resources/ffmpeg-manifest.json'), 'utf8'))
    const module = await loadVerifierModule()

    await expect(module.verifyFfmpegResource({ rootDirectory: root, manifest })).rejects.toThrow('RESOURCE_FFMPEG_REPARSE_POINT')
  })

  it('requires the production model manifest to be tracked before parsing it', async () => {
    const fixture = await createFixture()
    fixture.trackedFiles.delete('resources/model-manifest.json')
    const verify = await loadVerifier()

    await expect(verify({
      rootDirectory: fixture.root,
      packageJson: fixture.packageJson,
      trackedFiles: fixture.trackedFiles,
      sourceCommit: 'a'.repeat(40),
      verifyGeneratedScrapling: async () => fixture.scraplingManifest,
      verifyFfmpeg: async () => ({ size: 1, sha256: 'b'.repeat(64) })
    })).rejects.toThrow('RESOURCE_MANIFEST_NOT_GIT_TRACKED:resources/model-manifest.json')
  })

  it('requires the production FFmpeg manifest to be tracked before parsing it', async () => {
    const fixture = await createFixture()
    const module = await loadVerifierModule()

    await expect(module.verifyFfmpegResource({ rootDirectory: fixture.root, trackedFiles: fixture.trackedFiles }))
      .rejects.toThrow('RESOURCE_MANIFEST_NOT_GIT_TRACKED:resources/ffmpeg-manifest.json')
  })

  it('rejects a non-regular tracked production manifest before parsing it', async () => {
    const fixture = await createFixture()
    await rm(join(fixture.root, 'resources', 'model-manifest.json'))
    await mkdir(join(fixture.root, 'resources', 'model-manifest.json'))
    const verify = await loadVerifier()

    await expect(verify({
      rootDirectory: fixture.root,
      packageJson: fixture.packageJson,
      trackedFiles: fixture.trackedFiles,
      sourceCommit: 'a'.repeat(40),
      verifyGeneratedScrapling: async () => fixture.scraplingManifest,
      verifyFfmpeg: async () => ({ size: 1, sha256: 'b'.repeat(64) })
    })).rejects.toThrow('RESOURCE_MANIFEST_REPARSE_POINT:resources/model-manifest.json')
  })
})
