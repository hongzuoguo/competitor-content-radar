# Douyin Public Share Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept common `modal_id` Douyin links and resolve public work metadata/media through the same share-page strategy demonstrated by the reference toolbox, with safe sequential fallbacks for both manual imports and monitored works.

**Architecture:** URL normalization extracts a trusted numeric work ID before any request. A standalone resolver requests only fixed Douyin/iesdouyin endpoints, parses `_ROUTER_DATA` or JSON through the existing work normalizer, and falls back sequentially to the real-browser capture port. Manual import and creator monitoring share this resolver; complete discovered works bypass it, while incomplete new works execute one enrichment pass.

**Tech Stack:** TypeScript, Node/Electron `fetch`, React, Vitest, existing Douyin payload normalizers and import pipeline.

---

## Task 1: Accept and normalize `modal_id` work links

**Files:**
- Modify: `src/services/import/douyin-video-source.ts`
- Modify: `src/renderer/src/features/works/ImportWorkDialog.tsx`
- Test: `tests/services/import-douyin-video.test.ts`
- Test: `tests/renderer/import-work.test.tsx`

- [ ] **Step 1: Write failing normalization tests**

```ts
it('normalizes a work opened from a creator modal', () => {
  expect(normalizeDouyinVideoUrl(
    'https://www.douyin.com/user/self?from_tab_name=main&modal_id=7659607768617307402'
  )).toEqual({
    videoId: '7659607768617307402',
    canonicalUrl: 'https://www.douyin.com/video/7659607768617307402'
  })
})

it.each([
  'https://www.douyin.com/user/self',
  'https://www.douyin.com/user/self?modal_id=',
  'https://www.douyin.com/user/self?modal_id=abc',
  'https://www.douyin.com/user/self?modal_id=123&modal_id=456',
  'https://evil.example/user/self?modal_id=123'
])('rejects non-work modal input %s', (url) => {
  expect(() => normalizeDouyinVideoUrl(url)).toThrow('INVALID_DOUYIN_VIDEO_URL')
})
```

- [ ] **Step 2: Write failing renderer validation tests**

Submit a `user/self?modal_id=<digits>` link and assert `desktopApi.startImport` receives the original string. Submit a pure creator page and assert the existing “不支持博主主页” field error remains.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm test -- tests/services/import-douyin-video.test.ts tests/renderer/import-work.test.tsx`

Expected: modal links fail validation.

- [ ] **Step 4: Implement one shared URL-shape rule**

Add an exported pure helper used by both backend normalization and renderer validation:

```ts
export function parseDouyinWorkUrl(input: string):
  | { kind: 'direct'; videoId: string }
  | { kind: 'modal'; videoId: string }
  | { kind: 'short'; url: URL }
```

Keep it in `douyin-video-source.ts` and expose an IPC-safe renderer helper from a small shared module only if renderer bundling cannot import the service file. Accept modal links only on exact `douyin.com`/`www.douyin.com`, HTTPS, empty credentials/port, `/user/<one non-empty segment>`, and exactly one numeric `modal_id`. Ignore unrelated query parameters. Pure creator pages remain invalid.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/services/import-douyin-video.test.ts tests/renderer/import-work.test.tsx`

Expected: PASS.

```powershell
git add src/services/import/douyin-video-source.ts src/renderer/src/features/works/ImportWorkDialog.tsx tests/services/import-douyin-video.test.ts tests/renderer/import-work.test.tsx
git commit -m "feat: accept Douyin modal work links"
```

## Task 2: Parse the public share page safely

**Files:**
- Create: `src/services/douyin/public-share-resolver.ts`
- Test: `tests/services/douyin-public-share-resolver.test.ts`

- [ ] **Step 1: Write failing `_ROUTER_DATA` tests**

```ts
it('extracts the target work from video page router data', async () => {
  const fetcher = vi.fn().mockResolvedValue(htmlResponse(routerHtml(videoPayload)))
  await expect(resolvePublicDouyinVideo('7658', { fetcher })).resolves.toMatchObject({
    videoId: '7658', title: '作品文案', downloadUrl: expect.stringMatching(/^https:/),
    source: 'share_router'
  })
})
```

Cover `video_(id)/page`, `note_(id)/page`, target-ID mismatch, missing script, malformed JSON, non-HTML content type, body over 5 MiB, timeout, and risk-control text.

- [ ] **Step 2: Run the resolver tests and verify RED**

Run: `npm test -- tests/services/douyin-public-share-resolver.test.ts`

Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Implement the resolver contract and secure fetch**

```ts
export interface PublicDouyinVideo {
  videoId: string
  title: string
  downloadUrl: string | null
  authorName: string | null
  likes: number | null
  comments: number | null
  shares: number | null
  coverUrl: string | null
  source: 'share_router' | 'detail_api' | 'share_page' | 'iteminfo_api'
}

export async function resolvePublicDouyinVideo(
  videoId: string,
  options?: { fetcher?: typeof fetch; timeoutMs?: number; maxBodyBytes?: number }
): Promise<PublicDouyinVideo | null>
```

Reject non-numeric IDs before requesting. Generate `https://www.iesdouyin.com/share/video/${videoId}` internally. Use a fixed mobile Safari-compatible User-Agent, `credentials:'omit'`, `redirect:'manual'`, and a 12-second timeout. Follow at most three redirects, validating every hop against exact HTTPS hosts `www.iesdouyin.com`, `iesdouyin.com`, `www.douyin.com`, or `douyin.com`; cancel each response body after use/failure. Read the body through a byte-limited stream rather than unbounded `text()`.

Extract the smallest `window._ROUTER_DATA = ...</script>` segment, parse JSON, select only the known video/note loader node, and pass the payload through `extractWorkFromPayload(videoId, payload)`. Return `null` on ordinary parse absence. Throw a stable `DOUYIN_RISK_CONTROL` error immediately when existing risk guards match; do not continue fallbacks.

- [ ] **Step 4: Validate media URLs without trusting string replacement**

Accept media URLs only when HTTPS, credentials/port are empty, and hostname is the original Douyin CDN hostname returned by the payload. If a pathname contains a standalone `playwm` segment/token, derive a `play` variant with `URL` APIs; otherwise retain the original. The existing downloader still validates every redirect. Tests must reject `javascript:`, embedded credentials, custom ports, and strings where `playwm` appears only inside another word.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/services/douyin-public-share-resolver.test.ts tests/services/douyin-session-guards.test.ts`

Expected: PASS.

```powershell
git add src/services/douyin/public-share-resolver.ts tests/services/douyin-public-share-resolver.test.ts
git commit -m "feat: parse Douyin public share data"
```

## Task 3: Add sequential public endpoint and browser fallbacks

**Files:**
- Modify: `src/services/douyin/public-share-resolver.ts`
- Modify: `src/services/import/douyin-video-source.ts`
- Test: `tests/services/douyin-public-share-resolver.test.ts`
- Test: `tests/services/import-douyin-video.test.ts`

- [ ] **Step 1: Write failing ordered-fallback tests**

Assert the exact order:

1. `https://www.iesdouyin.com/share/video/<ID>` router data
2. `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=<ID>&aid=6383`
3. `https://www.douyin.com/share/video/<ID>` router/meta data
4. `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=<ID>`
5. injected `captureSingleVideo(videoId, canonicalUrl)`

Tests must prove success stops later requests, ordinary absence moves to the next source, risk control stops immediately, and target-ID mismatch is ignored.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/services/douyin-public-share-resolver.test.ts tests/services/import-douyin-video.test.ts`

Expected: ordered fallback tests fail.

- [ ] **Step 3: Implement sequential endpoint parsing**

Use one request at a time. For JSON endpoints require JSON content type and reuse `extractWorkFromPayload`. For `www.douyin.com/share/video/<ID>`, first parse router data, then Open Graph title/description only as metadata; Open Graph tags must never supply the media URL. Each returned work must match the requested numeric ID.

Change manual resolution to:

```ts
const publicVideo = await resolvePublicDouyinVideo(normalized.videoId, { fetcher: resolver })
const captured = publicVideo?.downloadUrl
  ? publicVideo
  : await capturePort.captureSingleVideo(normalized.videoId, normalized.canonicalUrl)
```

If public metadata exists without media, preserve its title while trying browser capture. Browser capture runs at most once. If no source supplies media, throw the existing `DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE` with `action:'upload_local'`.

- [ ] **Step 4: Add sanitized diagnostics**

Allow an injected reporter to record only `videoId`, source name, stable outcome code, and elapsed milliseconds. Never log media URLs, response bodies, cookies, headers, or the original query string.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/services/douyin-public-share-resolver.test.ts tests/services/import-douyin-video.test.ts`

Expected: PASS.

```powershell
git add src/services/douyin/public-share-resolver.ts src/services/import/douyin-video-source.ts tests/services/douyin-public-share-resolver.test.ts tests/services/import-douyin-video.test.ts
git commit -m "feat: resolve Douyin videos with public fallbacks"
```

## Task 4: Share enrichment with automatic creator monitoring

**Files:**
- Modify: `src/main/production-runtime.ts`
- Modify: `src/services/database/repositories.ts`
- Modify: `README.md`
- Test: `tests/main/production-runtime.test.ts`
- Test: `tests/main/runtime.test.ts`

- [ ] **Step 1: Write failing monitored-work enrichment tests**

```ts
it('enriches only a new discovered work missing media', async () => {
  discovery.mockResolvedValue([completeWork, incompleteWork, alreadyStoredWork])
  publicResolver.mockResolvedValue({ videoId: incompleteWork.platformWorkId, title: '补全文案', downloadUrl: mediaUrl })
  await runtime.runNow()
  expect(publicResolver).toHaveBeenCalledTimes(1)
  expect(publicResolver).toHaveBeenCalledWith(incompleteWork.platformWorkId, expect.anything())
})
```

Cover: complete new work bypasses public requests; stored duplicate bypasses enrichment; one incomplete work receives exactly one enrichment pass; public metadata updates title/media without losing creator/metrics; risk control stops that work and does not loop; unavailable media reaches the existing actionable failure.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/main/production-runtime.test.ts tests/main/runtime.test.ts`

Expected: incomplete monitored works still fail immediately with `DOUYIN_MEDIA_URL_MISSING`.

- [ ] **Step 3: Add an explicit enrichment port**

Extend the processing boundary without coupling runtime to HTTP:

```ts
export interface RuntimePorts {
  // existing ports
  enrichWork?(work: Work): Promise<Partial<Pick<Work, 'title' | 'downloadUrl'>>>
}
```

After discovery deduplication and before `processWork`, call `enrichWork` only for a new work whose title is blank or `downloadUrl` is null. Merge only non-empty returned fields, persist the enriched work atomically, and then process it. A complete work and an already stored work must not call the port.

Production `enrichWork` first calls `resolvePublicDouyinVideo(work.platformWorkId)`. When public data lacks media, it calls the same real-browser single-video capture once. It never starts a second creator-page discovery.

- [ ] **Step 4: Update user documentation**

Document that single links and automatic monitoring share the public resolver; the app first deduplicates new works, avoids redundant requests when browser discovery is complete, and falls back to local upload when no media source is available. State that the resolver does not bypass Douyin restrictions.

- [ ] **Step 5: Run complete verification**

```powershell
npm test
npm run typecheck
npm run build
git diff --check
git status --short
```

Expected: all tests pass except the existing Windows permission-gated symlink test; typecheck/build/diff-check pass.

- [ ] **Step 6: Commit**

```powershell
git add src/main/production-runtime.ts src/main/runtime.ts src/services/database/repositories.ts README.md tests/main/production-runtime.test.ts tests/main/runtime.test.ts
git commit -m "feat: enrich monitored Douyin works"
```

## Task 5: Candidate-package and real-link acceptance

**Files:**
- Modify only if verification finds a confirmed defect in files already owned by Tasks 1–4.

- [ ] **Step 1: Build an unpublished Windows candidate**

Run: `npm run dist`

Expected: unpacked executable, installer, blockmap, and `latest.yml` exist; no version bump, tag, push, or release occurs.

- [ ] **Step 2: Verify the reference-style modal link**

Use an unpublished candidate and the user-provided link shape `https://www.douyin.com/user/self?...&modal_id=<ID>`. Confirm it passes field validation, starts one job, returns the real title instead of `video`, and either reaches transcription or preserves metadata while showing “改为上传本地视频”.

- [ ] **Step 3: Verify direct, short, and pure creator links**

Confirm canonical `/video/<ID>` and a valid `v.douyin.com` link work; a pure `/user/...` link remains rejected before task creation.

- [ ] **Step 4: Verify automatic monitoring reuse**

With one newly discovered complete work and one missing-media work, confirm only the incomplete work uses public fallback, both keep interaction metrics, and no repeated refresh loop appears in logs.

- [ ] **Step 5: Run final automated checks again**

Run: `npm test && npm run typecheck && npm run build && git diff --check`

Expected: PASS with only the documented permission-gated test skipped.

- [ ] **Step 6: Stop progress automation and shut down**

After Tasks 1–5 pass their spec and quality reviews, stop automation ID `30`, close the unpublished candidate and any app-owned browser/process, verify Git worktree state is preserved, then execute Windows shutdown as explicitly requested by the user. Do not publish or replace the installed application before the next session's remaining manual acceptance and release decision.
