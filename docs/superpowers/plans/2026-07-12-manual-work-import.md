# Manual Work Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-blocking “导入作品” workflow that accepts local videos or one Douyin video URL, optionally associates a creator, and reuses the existing transcription and AI-analysis pipeline.

**Architecture:** Source adapters normalize local files and Douyin URLs into one persisted `Work` plus a managed media path. An `ImportService` owns validation, deduplication, job creation, background stage transitions, retry, and notifications; Electron IPC exposes narrow commands and read models to the React renderer. SQLite remains the source of truth, and the UI polls real job rows rather than keeping progress only in component state.

**Tech Stack:** Electron 43, React 19, TypeScript, better-sqlite3, FFmpeg, sherpa-onnx SenseVoice, Vitest, Testing Library

---

## File map

**Create**

- `src/services/import/local-file-source.ts` — local validation, SHA-256 fingerprinting, space check, managed copy.
- `src/services/import/douyin-video-source.ts` — single-video URL normalization and public media resolution.
- `src/services/import/import-service.ts` — deduplication, persistence, background execution, retry.
- `src/services/import/import-errors.ts` — stable error codes and Chinese user messages.
- `src/renderer/src/features/works/ImportWorkDialog.tsx` — source tabs, file/link form, creator selection, error state.
- `src/renderer/src/features/works/WorkStatusRow.tsx` — real stage and retry display.
- `tests/services/import-local-file.test.ts`, `tests/services/import-douyin-video.test.ts`, `tests/services/import-service.test.ts`, `tests/renderer/import-work.test.tsx`.

**Modify**

- `src/core/domain.ts`, `src/core/workflow.ts` — source metadata and import stages.
- `src/services/database/migrations.ts`, `src/services/database/database.ts`, `src/services/database/repositories.ts` — nullable creator, source identity, media path, complete job read model.
- `src/services/douyin/session.ts` — resolve one video while preserving the persistent login session.
- `src/main/production-runtime.ts`, `src/main/runtime.ts`, `src/main/ipc.ts`, `src/main/index.ts` — service assembly, commands, file picker, desktop notifications.
- `src/shared/ipc-contract.ts`, `src/preload/index.ts` — typed import/list/retry API.
- `src/renderer/src/pages/WorksPage.tsx`, `src/renderer/src/pages/workspace-pages.css` — replace demo-only rows with live records and add the confirmed modal entry.
- `src/services/media/cleanup.ts` — configured retention and protection for active jobs.

## Task 1: Evolve the database and domain model

**Files:**

- Modify: `src/core/domain.ts`
- Modify: `src/core/workflow.ts`
- Modify: `src/services/database/migrations.ts`
- Modify: `src/services/database/database.ts`
- Modify: `src/services/database/repositories.ts`
- Test: `tests/services/database.test.ts`

- [ ] **Step 1: Write failing migration and repository tests**

Add tests proving schema version 2, nullable creator association, unique `(source_type, source_key)`, managed media path persistence, and full job state:

```ts
it('stores an unclassified imported work and finds it by source identity', () => {
  const work = repositories.works.upsert({
    id: 'manual:sha256:abc', creatorId: null, platformWorkId: null,
    sourceType: 'local_file', sourceKey: 'sha256:abc', mediaPath: 'C:\\media\\abc\\video.mp4',
    title: '本地样片', publishedAt: '2026-07-12T00:00:00.000Z', originalUrl: null,
    downloadUrl: null, metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
  })
  expect(repositories.works.findBySource('local_file', 'sha256:abc')).toEqual(work)
})

it('persists a failed job with a retryable error', () => {
  repositories.jobs.save({
    workId: 'manual:sha256:abc', stage: 'transcription', status: 'failed', attemptCount: 1,
    errorCode: 'TRANSCRIPTION_FAILED', errorMessage: '文字转写失败', updatedAt: '2026-07-12T00:01:00.000Z'
  })
  expect(repositories.jobs.get('manual:sha256:abc')?.status).toBe('failed')
})
```

- [ ] **Step 2: Run the database test and verify RED**

Run: `npm test -- tests/services/database.test.ts`

Expected: FAIL because `Work.creatorId` is not nullable and `findBySource`, `jobs.save`, and `jobs.get` do not exist.

- [ ] **Step 3: Add version-2 migration and domain types**

Define:

```ts
export type WorkSourceType = 'douyin_monitor' | 'douyin_url' | 'local_file'

export interface Work {
  id: string
  creatorId: string | null
  platformWorkId: string | null
  sourceType: WorkSourceType
  sourceKey: string
  mediaPath: string | null
  title: string
  publishedAt: string
  originalUrl: string | null
  downloadUrl: string | null
  metrics: EngagementMetrics
}
```

Migration 2 must rebuild `works` with nullable `creator_id`, nullable `platform_work_id`, and new non-null `source_type`/`source_key` plus nullable `media_path`. Copy existing rows as `source_type='douyin_monitor'` and `source_key='douyin:' || platform_work_id`, then recreate indexes including `UNIQUE(source_type, source_key)`. Update `AppDatabase.migrate()` to disable foreign keys before the migration transaction, restore them in `finally`, and run `PRAGMA foreign_key_check`; preserve a backup before migration.

Implement `WorkRepository.findBySource`, `JobRepository.save/get/list`, and mapping for all new columns. Keep `saveStage()` as a small compatibility wrapper around `save()`.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- tests/services/database.test.ts && npm run typecheck`

Expected: PASS with schema version 2 and no TypeScript errors.

- [ ] **Step 5: Commit**

```powershell
git add src/core/domain.ts src/core/workflow.ts src/services/database/migrations.ts src/services/database/database.ts src/services/database/repositories.ts tests/services/database.test.ts
git commit -m "feat: persist imported work sources and job state"
```

## Task 2: Implement managed local-file ingestion

**Files:**

- Create: `src/services/import/import-errors.ts`
- Create: `src/services/import/local-file-source.ts`
- Test: `tests/services/import-local-file.test.ts`

- [ ] **Step 1: Write failing local-ingestion tests**

Use a temporary directory and assert supported extensions, deterministic SHA-256, duplicate identity, and copied destination:

```ts
it('copies a supported video to a content-addressed managed path', async () => {
  const result = await ingestLocalFile(source, mediaRoot)
  expect(result.sourceType).toBe('local_file')
  expect(result.sourceKey).toMatch(/^sha256:[a-f0-9]{64}$/)
  expect(result.mediaPath).toBe(join(mediaRoot, result.sourceKey.slice(7), 'video.mp4'))
  expect(readFileSync(result.mediaPath)).toEqual(readFileSync(source))
})

it('rejects unsupported files before copying', async () => {
  await expect(ingestLocalFile(textFile, mediaRoot)).rejects.toMatchObject({ code: 'UNSUPPORTED_VIDEO_FORMAT' })
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/services/import-local-file.test.ts`

Expected: FAIL because the import modules do not exist.

- [ ] **Step 3: Implement validation, hash, capacity check, and atomic copy**

Export this contract:

```ts
export interface ImportedMedia {
  sourceType: 'local_file' | 'douyin_url'
  sourceKey: string
  title: string
  mediaPath: string
  originalUrl: string | null
}

export async function ingestLocalFile(sourcePath: string, mediaRoot: string): Promise<ImportedMedia>
```

Accept `.mp4`, `.mov`, `.mkv`, `.webm`; reject missing/non-file paths; stream the file through SHA-256; use `statfs` to require available bytes greater than source size plus 100 MB; copy to a temporary sibling and rename atomically to `<mediaRoot>/<hash>/video.<ext>`. Map errors to `FILE_NOT_FOUND`, `UNSUPPORTED_VIDEO_FORMAT`, `INSUFFICIENT_DISK_SPACE`, and `MEDIA_COPY_FAILED` with Chinese messages.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/services/import-local-file.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/services/import/import-errors.ts src/services/import/local-file-source.ts tests/services/import-local-file.test.ts
git commit -m "feat: ingest local videos into managed storage"
```

## Task 3: Implement the single-Douyin-video source adapter

**Files:**

- Create: `src/services/import/douyin-video-source.ts`
- Modify: `src/services/douyin/session.ts`
- Test: `tests/services/import-douyin-video.test.ts`

- [ ] **Step 1: Write failing URL and fallback tests**

```ts
it('normalizes a single Douyin video URL and uses its video id as source key', () => {
  expect(normalizeDouyinVideoUrl('https://www.douyin.com/video/7658288075461725474?previous_page=app_code_link'))
    .toEqual({ url: 'https://www.douyin.com/video/7658288075461725474', videoId: '7658288075461725474' })
})

it('maps an unavailable public media URL to local-upload guidance', async () => {
  await expect(resolveDouyinVideo(url, vi.fn().mockResolvedValue(null)))
    .rejects.toMatchObject({ code: 'DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE', action: 'upload_local' })
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/services/import-douyin-video.test.ts`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement normalization and bounded media resolution**

Only accept `https://www.douyin.com/video/<digits>` and `https://v.douyin.com/<code>`; resolve short links once and revalidate the final URL. Add `DouyinBrowserSession.captureSingleVideo(videoId, url)` using the existing persistent session, initialized debugger, and the same 10/30-second boundaries. Return normalized title and `downloadUrl`, or `null` when the response is absent, verification is required, or the media URL is unavailable. Do not call any external desktop program and do not retry risk-control responses.

The adapter returns:

```ts
export interface DouyinVideoDescriptor {
  sourceType: 'douyin_url'
  sourceKey: `douyin:${string}`
  title: string
  originalUrl: string
  downloadUrl: string
}
```

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/services/import-douyin-video.test.ts tests/services/discovery.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/services/import/douyin-video-source.ts src/services/douyin/session.ts tests/services/import-douyin-video.test.ts
git commit -m "feat: resolve single Douyin video imports"
```

## Task 4: Build the unified background import pipeline

**Files:**

- Create: `src/services/import/import-service.ts`
- Modify: `src/main/production-runtime.ts`
- Modify: `src/main/runtime.ts`
- Test: `tests/services/import-service.test.ts`
- Test: `tests/main/runtime.test.ts`

- [ ] **Step 1: Write failing orchestration tests**

Cover immediate acceptance, duplicate return, stage persistence, AI-only retry, and failure capture:

```ts
it('returns immediately and completes a local import in the background', async () => {
  const accepted = await service.start({ source: { type: 'local', path: video }, creatorId: null })
  expect(accepted).toMatchObject({ accepted: true, workId: expect.any(String) })
  expect(repositories.jobs.get(accepted.workId)?.status).toBe('running')
  await vi.waitFor(() => expect(repositories.jobs.get(accepted.workId)?.status).toBe('completed'))
})

it('returns the existing work without running the pipeline again', async () => {
  const result = await service.start({ source: { type: 'local', path: duplicate }, creatorId: null })
  expect(result).toEqual({ accepted: false, reason: 'duplicate', existingWorkId: 'manual:existing' })
  expect(transcribe).not.toHaveBeenCalled()
})

it('retries AI without transcribing a second time', async () => {
  await service.retry('manual:failed-ai')
  expect(transcribe).not.toHaveBeenCalled()
  expect(analyze).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/services/import-service.test.ts tests/main/runtime.test.ts`

Expected: FAIL because `ImportService` and runtime import methods do not exist.

- [ ] **Step 3: Extract reusable processing stages and implement ImportService**

Move the current local stages from `production-runtime.ts` behind a `WorkProcessor` port:

```ts
export interface WorkProcessor {
  extractAudio(workId: string, mediaPath: string): Promise<string>
  transcribe(workId: string, wavPath: string): Promise<string>
  analyze(workId: string, transcript: string, settings: PublicSettings): Promise<ProcessedWork>
}
```

`ImportService.start()` validates creator existence, ingests/resolves source, checks `findBySource`, creates the `Work` and running job in one transaction, launches `void execute(workId)`, and returns immediately. `execute()` saves each stage before and after work, persists the transcript before AI so retry can reuse it, catches errors into the job row, and always releases its concurrency gate. Use concurrency 2 for downloads, 1 for transcription, and 2 for AI via existing `ConcurrencyGate`.

`retry(workId)` begins from the persisted failed stage. It must not restart a completed job and returns `JOB_NOT_RETRYABLE` for invalid state.

- [ ] **Step 4: Run orchestration tests and typecheck**

Run: `npm test -- tests/services/import-service.test.ts tests/main/runtime.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/services/import/import-service.ts src/main/production-runtime.ts src/main/runtime.ts tests/services/import-service.test.ts tests/main/runtime.test.ts
git commit -m "feat: run imported works through the analysis pipeline"
```

## Task 5: Add typed IPC, file selection, list reads, and job events

**Files:**

- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Test: `tests/main/ipc-contract.test.ts`

- [ ] **Step 1: Write failing contract assertions**

Assert these channels and request/response types are exposed:

```ts
expect(IPC_CHANNELS).toMatchObject({
  importPickLocal: 'imports:pick-local', importStart: 'imports:start', importRetry: 'imports:retry',
  workList: 'works:list', workStateChanged: 'works:state-changed'
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/main/ipc-contract.test.ts`

Expected: FAIL because the channels are absent.

- [ ] **Step 3: Implement narrow IPC APIs**

Add shared types:

```ts
export type ImportRequest =
  | { source: { type: 'local'; path: string }; creatorId: string | null }
  | { source: { type: 'douyin_url'; url: string }; creatorId: string | null }

export interface WorkListItem {
  id: string; creatorName: string; title: string; sourceType: WorkSourceType
  publishedAt: string; status: 'pending' | 'running' | 'completed' | 'failed'
  stage: string; errorMessage: string | null; retryable: boolean
}
```

`imports:pick-local` calls `dialog.showOpenDialog` with one-file mode and MP4/MOV/MKV/WebM filters. Validate all IPC payloads with explicit type guards in main; never trust renderer paths or URL strings without the service-level checks. Add preload methods `pickLocalVideo`, `startImport`, `retryImport`, `listWorks`, and `onWorkStateChanged` with unsubscribe behavior matching update events.

- [ ] **Step 4: Run contract tests and typecheck**

Run: `npm test -- tests/main/ipc-contract.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/ipc-contract.ts src/main/ipc.ts src/preload/index.ts src/main/index.ts tests/main/ipc-contract.test.ts
git commit -m "feat: expose typed work import IPC"
```

## Task 6: Build the confirmed import dialog

**Files:**

- Create: `src/renderer/src/features/works/ImportWorkDialog.tsx`
- Modify: `src/renderer/src/pages/WorksPage.tsx`
- Modify: `src/renderer/src/pages/workspace-pages.css`
- Test: `tests/renderer/import-work.test.tsx`

- [ ] **Step 1: Write failing interaction tests**

```tsx
it('imports a local video with an optional creator', async () => {
  render(<WorksPage />)
  fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
  fireEvent.click(screen.getByRole('button', { name: '选择视频' }))
  await screen.findByText('样片.mp4')
  fireEvent.change(screen.getByLabelText('关联博主（可选）'), { target: { value: 'creator-1' } })
  fireEvent.click(screen.getByRole('button', { name: '开始分析' }))
  expect(desktopApi.startImport).toHaveBeenCalledWith({
    source: { type: 'local', path: 'C:\\video\\样片.mp4' }, creatorId: 'creator-1'
  })
})

it('switches to local upload when a Douyin URL is unavailable', async () => {
  desktopApi.startImport.mockRejectedValueOnce(Object.assign(new Error(), { code: 'DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE' }))
  // submit link, then assert the “改为上传本地视频” button and click it
  expect(await screen.findByRole('button', { name: '改为上传本地视频' })).toBeVisible()
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/renderer/import-work.test.tsx`

Expected: FAIL because the dialog and button do not exist.

- [ ] **Step 3: Implement the modal with the approved layout**

Use native `<dialog>` following the existing creator-delete pattern. Put “导入作品” beside “管理视图”; source tabs are keyboard-operable buttons with `aria-pressed`; keep creator choice when switching sources; show field-level validation; disable only while submitting. On duplicate response, close and select/open `existingWorkId`. On accepted response, close and show “任务已启动，请到作品分析查看进度”. Do not show fabricated percentages.

- [ ] **Step 4: Run renderer tests**

Run: `npm test -- tests/renderer/import-work.test.tsx tests/renderer/works.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/src/features/works/ImportWorkDialog.tsx src/renderer/src/pages/WorksPage.tsx src/renderer/src/pages/workspace-pages.css tests/renderer/import-work.test.tsx tests/renderer/works.test.tsx
git commit -m "feat: add work import dialog"
```

## Task 7: Replace demo work rows with live status and retry

**Files:**

- Create: `src/renderer/src/features/works/WorkStatusRow.tsx`
- Modify: `src/renderer/src/pages/WorksPage.tsx`
- Modify: `src/renderer/src/pages/workspace-pages.css`
- Modify: `src/main/runtime.ts`
- Test: `tests/renderer/works.test.tsx`
- Test: `tests/main/runtime.test.ts`

- [ ] **Step 1: Write failing live-list tests**

Test loading, empty, processing, completed, failed, retry, duplicate selection, and event refresh:

```tsx
it('shows a failed stage and retries only that work', async () => {
  desktopApi.listWorks.mockResolvedValue([failedWork])
  render(<WorksPage />)
  expect(await screen.findByText('AI 拆解失败')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '重试样片' }))
  expect(desktopApi.retryImport).toHaveBeenCalledWith(failedWork.id)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/renderer/works.test.tsx tests/main/runtime.test.ts`

Expected: FAIL because `WorksPage` still uses constant demo data and runtime has no work list read model.

- [ ] **Step 3: Implement the live read model and status rows**

Runtime joins works, creators, jobs, and analyses into `WorkListItem[]`; unknown creator is “未分类作品”. `WorksPage` loads on mount and refreshes when `onWorkStateChanged` fires. Preserve existing high-like/viral/value filters for completed monitored works and add “处理中 / 失败” status choices. `WorkStatusRow` uses a stage label and indeterminate progress for non-byte stages; failed rows show the stored message and retry button.

- [ ] **Step 4: Run tests and accessibility assertions**

Run: `npm test -- tests/renderer/works.test.tsx tests/renderer/import-work.test.tsx tests/main/runtime.test.ts`

Expected: PASS with no React act warnings.

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/src/features/works/WorkStatusRow.tsx src/renderer/src/pages/WorksPage.tsx src/renderer/src/pages/workspace-pages.css src/main/runtime.ts tests/renderer/works.test.tsx tests/main/runtime.test.ts
git commit -m "feat: show live imported work progress and retry"
```

## Task 8: Add notifications, restart safety, and retention-aware cleanup

**Files:**

- Modify: `src/main/index.ts`
- Modify: `src/services/import/import-service.ts`
- Modify: `src/services/media/cleanup.ts`
- Modify: `src/services/database/repositories.ts`
- Test: `tests/services/import-service.test.ts`
- Test: `tests/services/media-cleanup.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it('does not auto-run a failed import after restart', async () => {
  await service.recoverInterruptedJobs()
  expect(repositories.jobs.get(workId)?.status).toBe('failed')
  expect(processor.transcribe).not.toHaveBeenCalled()
})

it('keeps active media while removing expired completed media', () => {
  expect(cleanupExpiredMedia(root, { retentionDays: 7, protectedWorkIds: new Set(['active']) }, now))
    .toEqual([completedOldVideo])
  expect(existsSync(activeVideo)).toBe(true)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/services/import-service.test.ts tests/services/media-cleanup.test.ts`

Expected: FAIL because recovery and configurable protected cleanup are absent.

- [ ] **Step 3: Implement safe recovery, notifications, and cleanup**

On startup, convert stale `running` jobs to `failed` with `APP_INTERRUPTED` and `retryable=true`; never auto-run them. Pass `mediaRetentionDays` into cleanup and exclude work directories whose jobs are pending/running. Inject a notification port into `ImportService`; production uses Electron `Notification` with title “作品分析完成” or “作品分析失败”. Notification click shows/focuses the main window and navigates to the work using a renderer event.

- [ ] **Step 4: Run lifecycle tests**

Run: `npm test -- tests/services/import-service.test.ts tests/services/media-cleanup.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/main/index.ts src/services/import/import-service.ts src/services/media/cleanup.ts src/services/database/repositories.ts tests/services/import-service.test.ts tests/services/media-cleanup.test.ts
git commit -m "feat: harden imported work lifecycle"
```

## Task 9: Full verification, packaged smoke test, and release preparation

**Files:**

- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Update user documentation**

Document both import sources, supported formats, managed-file retention, duplicate behavior, URL fallback, model/API requirements, and the fact that the feature does not bypass Douyin restrictions.

- [ ] **Step 2: Run the complete automated verification**

Run:

```powershell
npm rebuild better-sqlite3
npm test
npm run typecheck
npm run build
```

Expected: all tests pass, typecheck exits 0, production renderer/main/preload bundles build successfully.

- [ ] **Step 3: Build the unpacked Windows app**

Run: `npm run dist:dir`

Expected: `release/win-unpacked/对标内容雷达.exe` exists and the packaged process starts with a renderer process.

- [ ] **Step 4: Perform manual acceptance using real inputs**

Verify in the packaged app:

1. Import one local MP4 as “未分类作品”; observe stage changes and completed analysis.
2. Import the same file again; confirm it opens the existing result without a second AI call.
3. Associate another local file with a creator.
4. Paste one public Douyin video URL. If downloading is blocked, confirm “改为上传本地视频” preserves the creator selection.
5. Force an invalid AI key, confirm the transcript remains and retry resumes from AI after restoring the key.
6. Restart during a task, confirm the job becomes explicitly retryable rather than silently auto-running.

- [ ] **Step 5: Restore the Node test ABI and rerun tests**

`dist:dir` rebuilds better-sqlite3 for Electron ABI 148. Run:

```powershell
npm rebuild better-sqlite3
npm test
```

Expected: all tests pass under Node ABI 137.

- [ ] **Step 6: Bump patch version only after acceptance**

Update `package.json` and both root version entries in `package-lock.json` to the next patch version using `apply_patch`, then run `npm run typecheck`.

- [ ] **Step 7: Commit release-ready changes**

```powershell
git add README.md package.json package-lock.json
git commit -m "docs: document manual work import"
```

- [ ] **Step 8: Request code review before publishing**

Invoke `superpowers:requesting-code-review`, address only verified findings, rerun the full verification, and then use `superpowers:finishing-a-development-branch` to choose merge/release handling. Do not tag or publish an updater release until the packaged manual acceptance passes.
