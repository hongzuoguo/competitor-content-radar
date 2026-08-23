import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const packagePath = resolve(process.cwd(), 'package.json')

async function readPackageJson(): Promise<Record<string, any>> {
  return JSON.parse(await readFile(packagePath, 'utf8'))
}

const prepareModuleUrl = pathToFileURL(resolve(process.cwd(), 'scripts/prepare-model-resource.mjs')).href
const releaseDependenciesModuleUrl = pathToFileURL(resolve(process.cwd(), 'scripts/verify-release-dependencies.mjs')).href

async function getPrepareModelResource() {
  const module = await import(prepareModuleUrl)
  expect(module.prepareModelResource).toBeTypeOf('function')
  return module.prepareModelResource as (options: Record<string, unknown>) => Promise<void>
}

function fileDefinition(content: string) {
  return {
    url: 'https://example.invalid/model',
    size: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex')
  }
}

async function withTemporaryDirectory(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'competitor-content-radar-model-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('offline model release package', () => {
  it('ships public license notices for the locked dependency and bundled-resource contracts', async () => {
    const notices = await readFile(resolve(process.cwd(), 'THIRD_PARTY_NOTICES.md'), 'utf8')
    const guide = await readFile(resolve(process.cwd(), 'docs/resources-and-licenses.md'), 'utf8')
    const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8')
    const license = await readFile(resolve(process.cwd(), 'LICENSE'), 'utf8')

    expect(notices).toContain('package-lock.json')
    expect(notices).toContain('ffmpeg-static 5.3.0')
    expect(notices).toContain('GPL-3.0-or-later')
    expect(notices).toContain('SenseVoice')
    expect(notices).toContain('LicenseRef-FunASR')
    expect(notices).toContain('scrapling[fetchers] 0.4.11')
    expect(notices).toContain('BSD 3-Clause License')
    expect(notices).toContain('Copyright (c) 2024, Karim shoair')
    expect(guide).toContain('Python hash lock')
    expect(guide).toContain('Scrapling')
    expect(guide).toContain('BSD-3-Clause')
    expect(guide).toContain('https://github.com/D4Vinci/Scrapling/tree/v0.4.11')
    expect(guide).toContain('source and redistribution obligations')
    expect(guide).toContain('https://github.com/FunAudioLLM/SenseVoice/blob/')
    expect(readme).toContain('HitMuse 自有源代码 Copyright (c) 2026 hongzuoguo')
    expect(readme).toContain('HitMuse 的 MIT 许可证不会替代或改变 Scrapling')
    expect(license).toContain('MIT License')
    expect(license).toContain('Copyright (c) 2026 hongzuoguo')
  })

  it('packages the built-in SenseVoice model with the release configuration', async () => {
    const packageJson = await readPackageJson()
    const modelManifest = JSON.parse(await readFile(resolve(process.cwd(), 'resources/model-manifest.json'), 'utf8'))

    expect(packageJson.version).toBe('1.1.0')
    expect(packageJson.scripts.dist).toContain('prepare:model')
    expect(packageJson.scripts.dist).toContain('verify:resources')
    expect(packageJson.scripts['dist:dir']).toContain('build:scrapling')
    expect(packageJson.scripts['dist:dir']).not.toContain('prepare:scrapling')
    expect(packageJson.scripts['dist:dir']).toContain('verify:resources')
    expect(packageJson.scripts.dist).toContain('verify:release-dependencies')
    expect(packageJson.scripts.dist).toContain('verify:packaged-app')
    expect(packageJson.build.extraResources).toContainEqual({
      from: '.build-resources/models',
      to: 'models'
    })
    expect(packageJson.build.extraResources).toContainEqual({
      from: '.build-resources/scrapling-engine/scrapling-engine-win32-x64.zip',
      to: 'scrapling-engine/scrapling-engine-win32-x64.zip'
    })
    expect(packageJson.build.extraResources).toContainEqual({
      from: '.build-resources/scrapling-engine/engine-manifest.json',
      to: 'scrapling-engine/manifest.json'
    })
    expect(packageJson.build.extraResources).toContainEqual({
      from: '.build-resources/scrapling-engine/engine-provenance.json',
      to: 'scrapling-engine/engine-provenance.json'
    })
    expect(JSON.stringify(packageJson.build.extraResources)).not.toContain('scrapling-engine-manifest.json')
    expect(modelManifest.upstream).toMatchObject({
      repository: 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
      revision: expect.stringMatching(/^[a-f0-9]{40}$/),
      license: 'LicenseRef-FunASR'
    })
    for (const file of Object.values(modelManifest.files) as Array<{ url: string }>) {
      expect(file.url).toMatch(/\/resolve\/[a-f0-9]{40}\//)
      expect(file.url).not.toContain('/resolve/main')
      expect(file.url).not.toContain('?download=')
    }
    expect(packageJson.build.publish).toEqual([{
      provider: 'github', owner: 'hongzuoguo', repo: 'competitor-content-radar', channel: 'latest', releaseType: 'release'
    }])
  })

  it('requires the exact installed FFmpeg package metadata and audited executable hash', async () => {
    const verifier = await import(`${releaseDependenciesModuleUrl}?test=${Date.now()}-${Math.random()}`)
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'resources/ffmpeg-manifest.json'), 'utf8'))

    await expect(verifier.verifyReleaseDependencies({ rootDirectory: process.cwd() })).resolves.toMatchObject({
      package: 'ffmpeg-static', version: '5.3.0'
    })
    await expect(verifier.verifyReleaseDependencies({
      rootDirectory: process.cwd(),
      manifest: { ...manifest, asset: { ...manifest.asset, decompressed: { ...manifest.asset.decompressed, sha256: '0'.repeat(64) } } }
    })).rejects.toThrow('RESOURCE_HASH_MISMATCH:node_modules/ffmpeg-static/ffmpeg.exe')
  }, 30_000)

  it('bypasses the broken 1.0.1 uninstaller without deleting user data', async () => {
    const installer = await readFile(resolve(process.cwd(), 'build/installer.nsh'), 'utf8')

    expect(installer).toContain('ReadRegStr $R1 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"')
    expect(installer).toContain('$R1 == "1.0.1"')
    expect(installer).toContain('DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"')
    expect(installer).toContain('DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"')
    expect(installer).toContain('StrCpy $INSTDIR "$LocalAppData\\Programs\\HitMuse App"')
    expect(installer).toContain('RMDir /r /REBOOTOK "$legacyInstallDir"')
    expect(installer).toContain('!ifndef BUILD_UNINSTALLER')
    expect(installer).toMatch(/!ifndef BUILD_UNINSTALLER\s+Var \/GLOBAL legacyInstallDir/)
    expect(installer).not.toContain('RMDir /r "$APPDATA"')
  })

  it('rejects release output that is missing packaged runtime dependencies', async () => {
    const verifier = await readFile(resolve(process.cwd(), 'scripts/verify-packaged-app.mjs'), 'utf8')

    expect(verifier).toContain('node_modules/fs-extra/package.json')
    expect(verifier).toContain('release/win-unpacked/HitMuse.exe')
    expect(verifier).toContain('PACKAGED_APP_DEPENDENCY_MISSING')
    expect(verifier).toContain("join(userData, 'logs', 'main.log')")
    expect(verifier).toContain('Application startup failed')
    expect(verifier).toContain('PACKAGED_APP_SMOKE_RETAINED')
    expect(verifier).not.toContain('rm(smokeRoot')
  })

  it('publishes verified public evidence only through the same-repository Node publisher', async () => {
    const workflow = await readFile(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8')
    const publisher = await readFile(resolve(process.cwd(), 'scripts/publish-github-release.mjs'), 'utf8')

    expect(workflow).toContain('node scripts/publish-github-release.mjs --repository "${{ github.repository }}"')
    expect(workflow).toContain('GITHUB_TOKEN: ${{ github.token }}')
    expect(workflow).not.toMatch(/HITMUSE_RESOURCE_GITHUB_TOKEN|RELEASES_REPOSITORY_TOKEN|gh auth|softprops|competitor-content-radar-releases/i)
    expect(publisher).toContain('GITHUB_TOKEN_REQUIRED')
    expect(publisher).toContain('RELEASE_DRAFT_CLEANUP_BLOCKED')
    expect(publisher).not.toMatch(/gh auth|ghp_|github_pat_|RELEASES_REPOSITORY_TOKEN|HITMUSE_RESOURCE_GITHUB_TOKEN/i)
  })

  it('reuses a verified model only from the current checkout destination', async () => {
    await withTemporaryDirectory(async (root) => {
      const manifest = {
        id: 'test-model',
        displayName: 'Test model',
        files: { 'model.bin': fileDefinition('model') }
      }
      const target = join(root, '.build-resources', 'models', manifest.id)
      const forbiddenSource = join(root, 'forbidden-source')
      await mkdir(target, { recursive: true })
      await mkdir(forbiddenSource)
      await writeFile(join(target, 'model.bin'), 'model')
      await writeFile(join(forbiddenSource, 'model.bin'), 'wrong')
      let fetchCalls = 0

      const prepareModelResource = await getPrepareModelResource()
      await prepareModelResource({
        rootDirectory: root,
        manifest,
        environment: { SENSEVOICE_MODEL_DIR: forbiddenSource, ALLOW_MODEL_DOWNLOAD: '0' },
        fetch: async () => { fetchCalls += 1; return new Response('unexpected') }
      })
      expect(fetchCalls).toBe(0)
    })
  })

  it('downloads a missing model automatically without permission flags or ModelSource', async () => {
    await withTemporaryDirectory(async (root) => {
      const manifest = {
        id: 'test-model',
        displayName: 'Test model',
        files: { 'model.bin': fileDefinition('model') }
      }
      let fetchCalls = 0

      const prepareModelResource = await getPrepareModelResource()
      await prepareModelResource({
        rootDirectory: root,
        manifest,
        environment: {},
        fetch: async () => { fetchCalls += 1; return new Response('model') }
      })

      expect(fetchCalls).toBe(1)
      await expect(readFile(join(root, '.build-resources', 'models', manifest.id, 'model.bin'), 'utf8')).resolves.toBe('model')
    })
  })

  it('retries transient manifest URL failures without using a local fallback', async () => {
    await withTemporaryDirectory(async (root) => {
      const manifest = {
        id: 'test-model',
        displayName: 'Test model',
        files: { 'model.bin': fileDefinition('model') }
      }
      let fetchCalls = 0
      const waits: number[] = []

      const prepareModelResource = await getPrepareModelResource()
      await prepareModelResource({
        rootDirectory: root,
        manifest,
        fetch: async () => {
          fetchCalls += 1
          if (fetchCalls < 3) throw new TypeError('fetch failed')
          return new Response('model')
        },
        retryDelays: [10, 20, 30],
        wait: async (milliseconds: number) => { waits.push(milliseconds) }
      })

      expect(fetchCalls).toBe(3)
      expect(waits).toEqual([10, 20])
      await expect(readFile(join(root, '.build-resources', 'models', manifest.id, 'model.bin'), 'utf8')).resolves.toBe('model')
    })
  })

  it('replaces an invalid current-checkout model by downloading verified bytes', async () => {
    await withTemporaryDirectory(async (root) => {
      const manifest = {
        id: 'test-model',
        displayName: 'Test model',
        files: { 'model.bin': fileDefinition('model') }
      }
      const target = join(root, '.build-resources', 'models', manifest.id)
      await mkdir(target, { recursive: true })
      await writeFile(join(target, 'model.bin'), 'wrong')

      const prepareModelResource = await getPrepareModelResource()
      await prepareModelResource({
        rootDirectory: root,
        manifest,
        environment: {},
        fetch: async () => new Response('model')
      })
      await expect(readFile(join(target, 'model.bin'), 'utf8')).resolves.toBe('model')
    })
  })

  it('ignores APPDATA and explicit model directories instead of using machine-local fallbacks', async () => {
    await withTemporaryDirectory(async (root) => {
      const manifest = {
        id: 'test-model',
        displayName: 'Test model',
        files: { 'model.bin': fileDefinition('model') }
      }
      const source = join(root, 'source')
      const appData = join(root, 'appdata')
      const cached = join(appData, 'competitor-content-radar', 'models', manifest.id)
      await mkdir(source)
      await writeFile(join(source, 'model.bin'), 'model')
      await mkdir(cached, { recursive: true })
      await writeFile(join(cached, 'model.bin'), 'model')
      let fetchCalls = 0

      const prepareModelResource = await getPrepareModelResource()
      await prepareModelResource({
        rootDirectory: root,
        manifest,
        environment: { SENSEVOICE_MODEL_DIR: source, APPDATA: appData, ALLOW_MODEL_DOWNLOAD: '0' },
        fetch: async () => { fetchCalls += 1; return new Response('model') }
      })
      expect(fetchCalls).toBe(1)
    })
  })

  it('removes partial downloads when downloading or validation fails', async () => {
    await withTemporaryDirectory(async (root) => {
      const manifest = {
        id: 'test-model',
        displayName: 'Test model',
        files: { 'model.bin': fileDefinition('model') }
      }
      const partial = join(root, '.build-resources', 'models', manifest.id, 'model.bin.part')
      await mkdir(resolve(partial, '..'), { recursive: true })
      await writeFile(partial, 'stale')

      const prepareModelResource = await getPrepareModelResource()
      await expect(prepareModelResource({
        rootDirectory: root,
        manifest,
        environment: {},
        fetch: async () => new Response('bad')
      })).rejects.toThrow('MODEL_SIZE_MISMATCH')
      await expect(readFile(partial)).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })
})
