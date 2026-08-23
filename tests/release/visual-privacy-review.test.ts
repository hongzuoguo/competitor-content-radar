import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { readVisualPrivacyReviewBinding, validateVisualPrivacyReview } from '../../scripts/verify-visual-privacy-review.mjs'

const commit = '0123456789abcdef0123456789abcdef01234567'
const execFileAsync = promisify(execFile)
const script = resolve('scripts/verify-visual-privacy-review.mjs')

type FixtureOptions = {
  review?: unknown
  manifest?: unknown
}

async function withFixture(options: FixtureOptions, run: (fixture: { manifest: string; review: string; reviewRoot: string }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'visual-privacy-review-'))
  const manifest = join(root, 'session', 'report', 'visual-privacy.json')
  const reviewRoot = join(root, 'reviews')
  const review = join(reviewRoot, 'review.json')
  const assets = [{ path: 'candidate/preview.png', bytes: 3, sha256: 'a'.repeat(64), status: 'REVIEW_REQUIRED' }]
  const manifestValue = options.manifest ?? { assets }
  try {
    await mkdir(dirname(manifest), { recursive: true })
    await mkdir(reviewRoot, { recursive: true })
    await writeFile(manifest, `${JSON.stringify(manifestValue)}\n`, 'utf8')
    const visualManifestSha256 = createHash('sha256').update(await (await import('node:fs/promises')).readFile(manifest)).digest('hex')
    const reviewValue = options.review ?? {
      schemaVersion: 1,
      commit,
      visualManifestSha256,
      assets: assets.map(({ status: _status, ...asset }) => ({ ...asset, result: 'PASS' }))
    }
    await writeFile(review, JSON.stringify(reviewValue), 'utf8')
    await run({ manifest, review, reviewRoot })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('visual privacy review validator', () => {
  it('accepts an exact all-PASS review bound to the manifest and commit', async () => {
    await withFixture({}, async (fixture) => {
      await expect(validateVisualPrivacyReview({ ...fixture, commit })).resolves.toEqual({ assets: 1 })
    })
  })

  it('reads only an exact review binding before full review validation', async () => {
    await withFixture({}, async (fixture) => {
      const binding = await readVisualPrivacyReviewBinding({ review: fixture.review, reviewRoot: fixture.reviewRoot })
      expect(binding).toEqual({
        commit,
        visualManifestSha256: createHash('sha256').update(await (await import('node:fs/promises')).readFile(fixture.manifest)).digest('hex')
      })
    })
  })

  it('rejects a malformed review binding before it can be reused for another manifest', async () => {
    await withFixture({}, async (fixture) => {
      await writeFile(fixture.review, JSON.stringify({ commit, visualManifestSha256: 'a'.repeat(64) }), 'utf8')
      await expect(readVisualPrivacyReviewBinding({ review: fixture.review, reviewRoot: fixture.reviewRoot }))
        .rejects.toThrow('VISUAL_PRIVACY_REVIEW_INVALID')
    })
  })

  it('prints only a stable success line from the CLI', async () => {
    await withFixture({}, async (fixture) => {
      await expect(execFileAsync(process.execPath, [script, '--manifest', fixture.manifest, '--review', fixture.review, '--commit', commit, '--review-root', fixture.reviewRoot], {
        encoding: 'utf8', windowsHide: true
      })).resolves.toMatchObject({ stdout: 'VISUAL_PRIVACY_REVIEW_PASSED\n', stderr: '' })
    })
  })

  it('rejects a review for a different commit', async () => {
    await withFixture({}, async (fixture) => {
      const review = JSON.parse(await (await import('node:fs/promises')).readFile(fixture.review, 'utf8'))
      review.commit = 'f'.repeat(40)
      await writeFile(fixture.review, JSON.stringify(review), 'utf8')
      await expect(validateVisualPrivacyReview({ ...fixture, commit })).rejects.toThrow('VISUAL_PRIVACY_REVIEW_INVALID')
    })
  })

  it('rejects a review with a mismatched manifest digest', async () => {
    await withFixture({}, async (fixture) => {
      const review = JSON.parse(await (await import('node:fs/promises')).readFile(fixture.review, 'utf8'))
      review.visualManifestSha256 = '0'.repeat(64)
      await writeFile(fixture.review, JSON.stringify(review), 'utf8')
      await expect(validateVisualPrivacyReview({ ...fixture, commit })).rejects.toThrow('VISUAL_PRIVACY_REVIEW_INVALID')
    })
  })

  it.each([
    ['missing', []],
    ['extra', [
      { path: 'candidate/preview.png', bytes: 3, sha256: 'a'.repeat(64), result: 'PASS' },
      { path: 'release/extra.png', bytes: 3, sha256: 'b'.repeat(64), result: 'PASS' }
    ]],
    ['duplicate', [
      { path: 'candidate/preview.png', bytes: 3, sha256: 'a'.repeat(64), result: 'PASS' },
      { path: 'candidate/preview.png', bytes: 3, sha256: 'a'.repeat(64), result: 'PASS' }
    ]]
  ])('rejects %s review assets', async (_name, assets) => {
    await withFixture({}, async (fixture) => {
      const review = JSON.parse(await (await import('node:fs/promises')).readFile(fixture.review, 'utf8'))
      review.assets = assets
      await writeFile(fixture.review, JSON.stringify(review), 'utf8')
      await expect(validateVisualPrivacyReview({ ...fixture, commit })).rejects.toThrow('VISUAL_PRIVACY_REVIEW_INVALID')
    })
  })

  it.each([
    ['bytes', { bytes: 4 }],
    ['hash', { sha256: 'b'.repeat(64) }]
  ])('rejects a review asset with mismatched %s', async (_name, replacement) => {
    await withFixture({}, async (fixture) => {
      const review = JSON.parse(await (await import('node:fs/promises')).readFile(fixture.review, 'utf8'))
      Object.assign(review.assets[0], replacement)
      await writeFile(fixture.review, JSON.stringify(review), 'utf8')
      await expect(validateVisualPrivacyReview({ ...fixture, commit })).rejects.toThrow('VISUAL_PRIVACY_REVIEW_INVALID')
    })
  })

  it('rejects a non-PASS review result', async () => {
    await withFixture({}, async (fixture) => {
      const review = JSON.parse(await (await import('node:fs/promises')).readFile(fixture.review, 'utf8'))
      review.assets[0].result = 'PENDING'
      await writeFile(fixture.review, JSON.stringify(review), 'utf8')
      await expect(validateVisualPrivacyReview({ ...fixture, commit })).rejects.toThrow('VISUAL_PRIVACY_REVIEW_INVALID')
    })
  })

  it('rejects a review directory or a reparse-point review path', async () => {
    await withFixture({}, async (fixture) => {
      await expect(validateVisualPrivacyReview({ ...fixture, review: fixture.reviewRoot, commit })).rejects.toThrow('VISUAL_PRIVACY_REVIEW_INVALID')
      const linkedRoot = join(dirname(fixture.reviewRoot), 'linked-reviews')
      await symlink(fixture.reviewRoot, linkedRoot, 'junction')
      await expect(validateVisualPrivacyReview({ ...fixture, review: join(linkedRoot, 'review.json'), reviewRoot: linkedRoot, commit })).rejects.toThrow('VISUAL_PRIVACY_REVIEW_INVALID')
    })
  })
})
