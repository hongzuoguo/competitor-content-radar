# Douyin Import Recovery and Failed Task Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cold-start Douyin link imports recover from transient transport failures and let users safely delete failed local task records.

**Architecture:** Keep public endpoints strictly serial, but give each request attempt its own timeout and one retry while a separate total deadline bounds the chain. Add failed-work deletion through the existing repository → import service → runtime → IPC → preload path, with a narrowly scoped managed-directory remover and an existing-style confirmation dialog in the works table.

**Tech Stack:** TypeScript, Electron IPC/preload, React 19, better-sqlite3, Node.js filesystem APIs, Vitest, Testing Library.

---

## File map

- Modify `src/services/douyin/public-share-resolver.ts`: per-attempt timeout, retry classification, total deadline, sanitized diagnostics.
- Modify `tests/services/douyin-public-share-resolver.test.ts`: cold-start retry and deterministic-error coverage.
- Create `src/services/media/remove-work-directory.ts`: fail-closed removal of one managed work directory.
- Create `tests/services/remove-work-directory.test.ts`: path, symlink, missing-file and cleanup-failure boundaries.
- Modify `src/services/database/repositories.ts`: delete a work by primary key and rely on existing foreign-key cascades.
- Modify `src/services/import/import-service.ts`: authorize failed-only deletion, reject active/non-failed jobs, clean files then delete in a transaction.
- Modify `tests/services/database.test.ts` and `tests/services/import-service.test.ts`: cascade and service behavior.
- Modify `src/shared/ipc-contract.ts`, `src/main/runtime.ts`, `src/main/ipc.ts`, `src/preload/index.ts`: expose `deleteFailedWork(workId)` safely.
- Modify `tests/main/ipc-contract.test.ts`, `tests/main/import-ipc.test.ts`, `tests/main/preload-work-events.test.ts`, `tests/main/runtime.test.ts`: boundary coverage.
- Modify `src/renderer/src/features/works/WorkStatusRow.tsx`, `src/renderer/src/pages/WorksPage.tsx`, `src/renderer/src/pages/workspace-pages.css`: failed-row delete action and confirmation state.
- Modify `tests/renderer/works.test.tsx`: visibility, confirmation, duplicate-click, success/error and focus behavior.

---

### Task 1: Retry transient public endpoint failures within a total deadline

**Files:**
- Modify: `src/services/douyin/public-share-resolver.ts`
- Test: `tests/services/douyin-public-share-resolver.test.ts`

- [ ] **Step 1: Write failing cold-start and classification tests**

Add tests with zero retry delay:

```ts
it('retries one transient endpoint failure before falling back', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('cold socket failed'))
    .mockResolvedValueOnce(response(routerHtml(video())))

  await expect(resolvePublicDouyinVideo(ID, {
    fetcher,
    retryDelayMs: 0
  })).resolves.toMatchObject({ source: 'share_router', videoId: ID })
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it.each([
  ['DOUYIN_RISK_CONTROL', () => response('captcha_challenge')],
  ['DOUYIN_PUBLIC_SHARE_BODY_TOO_LARGE', () => response('x', { headers: { 'content-length': '99' } })],
  ['DOUYIN_PUBLIC_SHARE_UNSAFE_REDIRECT', () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/x' } })]
])('does not retry deterministic failure %s', async (_code, nextResponse) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(nextResponse())
  await expect(resolvePublicDouyinVideo(ID, { fetcher, maxBodyBytes: 10, retryDelayMs: 0 })).rejects.toBeTruthy()
  expect(fetcher).toHaveBeenCalledOnce()
})
```

Add a fake-timer test where the first attempt waits for its signal and rejects with an abort-like transport failure, the retry succeeds, and a separate test proves `totalTimeoutMs` stops the entire chain.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/services/douyin-public-share-resolver.test.ts`

Expected: FAIL because retry options and retry behavior do not exist.

- [ ] **Step 3: Add minimal retry/deadline options**

Extend the options and diagnostics without exposing URLs:

```ts
export interface PublicShareResolverOptions {
  fetcher?: typeof fetch
  attemptTimeoutMs?: number
  totalTimeoutMs?: number
  retryDelayMs?: number
  maxBodyBytes?: number
  report?(event: PublicShareDiagnostic): void
}

export interface PublicShareDiagnostic {
  videoId: string
  source: PublicDouyinVideo['source']
  attempt: 1 | 2
  outcome: 'success' | 'not_found' | 'request_failed'
  resultCode: 'SUCCESS' | 'NOT_FOUND' | 'TRANSPORT_FAILED' | 'ATTEMPT_TIMEOUT'
  elapsedMs: number
}
```

Use one total `AbortController` with a 35-second timer. For each endpoint, run at most two attempts; each attempt gets a new controller/timer and combines cancellation with the total signal. Retry only `EndpointRequestFailedError`, including an attempt timeout converted into that transient class. Preserve immediate throws for `DouyinRiskControlError` and `PublicShareError` safety/body violations. Wait `retryDelayMs` (default 250 ms) with a timer that rejects immediately if the total signal aborts.

- [ ] **Step 4: Run focused and related import tests**

Run:

```powershell
npm test -- tests/services/douyin-public-share-resolver.test.ts tests/services/import-douyin-video.test.ts tests/services/import-service.test.ts
```

Expected: PASS; existing endpoint order and browser-once assertions remain unchanged.

- [ ] **Step 5: Commit Task 1**

```powershell
git add src/services/douyin/public-share-resolver.ts tests/services/douyin-public-share-resolver.test.ts
git commit -m "fix: retry transient Douyin share requests"
```

---

### Task 2: Delete one failed import and its managed work directory

**Files:**
- Create: `src/services/media/remove-work-directory.ts`
- Create: `tests/services/remove-work-directory.test.ts`
- Modify: `src/services/database/repositories.ts`
- Modify: `src/services/import/import-service.ts`
- Test: `tests/services/database.test.ts`
- Test: `tests/services/import-service.test.ts`

- [ ] **Step 1: Write failing filesystem and service tests**

Test the wished-for service API:

```ts
await expect(service.deleteFailed('failed-work')).resolves.toBeUndefined()
expect(repositories.works.get('failed-work')).toBeNull()
expect(repositories.jobs.get('failed-work')).toBeNull()
expect(repositories.artifacts.get('failed-work')).toBeNull()
```

Also assert:

- running, pending, completed, missing and active work reject with stable codes;
- cleanup failure leaves all database rows intact;
- a missing managed directory is success;
- `..`, absolute IDs, directory symlinks and a symlinked managed root fail closed;
- files outside `mediaRoot/<workId>` are never removed;
- deleting `works.id` cascades processing jobs, artifacts, snapshots and analyses.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm test -- tests/services/remove-work-directory.test.ts tests/services/database.test.ts tests/services/import-service.test.ts
```

Expected: FAIL because the removal helper, repository delete and service method do not exist.

- [ ] **Step 3: Implement the fail-closed managed-directory remover**

Create a focused API:

```ts
export interface RemoveWorkDirectoryDependencies {
  lstat(path: string): Promise<Stats>
  realpath(path: string): Promise<string>
  rm(path: string, options: { recursive: true; force: true }): Promise<void>
}

export async function removeManagedWorkDirectory(
  mediaRoot: string,
  workId: string,
  dependencies: RemoveWorkDirectoryDependencies = defaultDependencies
): Promise<void>
```

Require a non-empty safe work ID matching `/^[A-Za-z0-9_-]+$/`. Resolve the root and candidate, require the candidate to be exactly one child below the root, reject a symlinked/replaced root or candidate, and verify real paths remain within the confirmed root. Treat `ENOENT` for the candidate as success; propagate other cleanup failures with code `FAILED_WORK_FILE_CLEANUP_FAILED`.

- [ ] **Step 4: Implement repository and service deletion**

Add `WorkRepository.delete(id): void` with `DELETE FROM works WHERE id = ?`.

Add to `ImportService`:

```ts
async deleteFailed(workId: string): Promise<void> {
  const work = this.dependencies.repositories.works.get(workId)
  const job = this.dependencies.repositories.jobs.get(workId)
  if (!work || !job) throw new ImportError('FAILED_WORK_NOT_FOUND', 'The failed work was not found.')
  if (this.active.has(workId) || job.status !== 'failed') {
    throw new ImportError('WORK_DELETE_NOT_ALLOWED', 'Only failed work can be deleted.')
  }
  await removeManagedWorkDirectory(this.dependencies.mediaRoot, workId)
  this.dependencies.repositories.transaction(() => this.dependencies.repositories.works.delete(workId))
  this.pendingRequests.delete(workId)
  this.emit(workId)
}
```

Do not catch and sanitize inside the service; stable errors are serialized at IPC.

- [ ] **Step 5: Run focused tests and commit Task 2**

Run the Step 2 command. Expected: PASS.

```powershell
git add src/services/media/remove-work-directory.ts tests/services/remove-work-directory.test.ts src/services/database/repositories.ts src/services/import/import-service.ts tests/services/database.test.ts tests/services/import-service.test.ts
git commit -m "feat: delete failed import tasks safely"
```

---

### Task 3: Expose failed-work deletion through runtime and IPC

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/main/runtime.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/main/ipc-contract.test.ts`
- Test: `tests/main/import-ipc.test.ts`
- Test: `tests/main/preload-work-events.test.ts`
- Test: `tests/main/runtime.test.ts`

- [ ] **Step 1: Write failing contract and boundary tests**

Assert the new channel and method:

```ts
expect(IPC_CHANNELS.workDeleteFailed).toBe('works:delete-failed')
await expect(handlers.get(IPC_CHANNELS.workDeleteFailed)?.({}, ' failed-1 ')).resolves.toBeUndefined()
expect(deps.deleteFailedWork).toHaveBeenCalledWith('failed-1')
```

Reject non-string/blank IDs before calling runtime. Test preload invokes the exact channel. Test `DesktopRuntime.deleteFailedWork` delegates to `imports.deleteFailed` and reports `IMPORT_SERVICE_UNAVAILABLE` when imports are absent.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm test -- tests/main/ipc-contract.test.ts tests/main/import-ipc.test.ts tests/main/preload-work-events.test.ts tests/main/runtime.test.ts
```

Expected: FAIL because the channel and methods are absent.

- [ ] **Step 3: Implement the narrow IPC path**

Add:

```ts
workDeleteFailed: 'works:delete-failed'
```

Expose `deleteFailedWork(workId: string): Promise<void>` in `DesktopRuntime`, `IpcDependencies`, `DesktopApi`, and `desktopApi`. The IPC handler trims and validates the ID, calls runtime, and preserves only stable error code/message fields; do not return filesystem paths.

- [ ] **Step 4: Run focused tests and commit Task 3**

Run the Step 2 command. Expected: PASS.

```powershell
git add src/shared/ipc-contract.ts src/main/runtime.ts src/main/ipc.ts src/preload/index.ts tests/main/ipc-contract.test.ts tests/main/import-ipc.test.ts tests/main/preload-work-events.test.ts tests/main/runtime.test.ts
git commit -m "feat: expose failed task deletion"
```

---

### Task 4: Add the failed-row delete confirmation experience

**Files:**
- Modify: `src/renderer/src/features/works/WorkStatusRow.tsx`
- Modify: `src/renderer/src/pages/WorksPage.tsx`
- Modify: `src/renderer/src/pages/workspace-pages.css`
- Test: `tests/renderer/works.test.tsx`

- [ ] **Step 1: Write failing interaction tests**

Cover these observable behaviors:

```ts
expect(screen.getByRole('button', { name: '删除失败任务：失败样片' })).toBeInTheDocument()
expect(screen.queryByRole('button', { name: /删除失败任务：本地样片/ })).not.toBeInTheDocument()
fireEvent.click(screen.getByRole('button', { name: '删除失败任务：失败样片' }))
expect(screen.getByRole('dialog', { name: '删除失败任务？' })).toBeInTheDocument()
```

Then assert cancel does not call the API; confirm is disabled and reads `正在删除…` after one click; rapid double-click invokes once; success closes the dialog, refreshes works, removes the row and announces `失败任务已删除`; rejection keeps the dialog open, shows `删除失败，请稍后重试。`, and allows retry. Verify Escape cancels and focus returns to the delete button on cancellation.

- [ ] **Step 2: Run the renderer test and verify RED**

Run: `npm test -- tests/renderer/works.test.tsx`

Expected: FAIL because failed rows have no delete action or dialog.

- [ ] **Step 3: Add the row action and confirmation state**

In `WorkStatusRow`, add a `Trash2` secondary icon button only when `work.status === 'failed'`:

```tsx
<Button
  aria-label={`删除失败任务：${work.title}`}
  icon={<Trash2 size={15} />}
  onClick={() => onDeleteRequest(work)}
  variant="secondary"
>
  删除
</Button>
```

In `WorksPage`, store `pendingDelete`, `deleting`, and `deleteError`. Use the existing `.confirm-dialog` vocabulary and exact approved copy. Keep the dialog open during errors, guard repeated calls, call `desktopApi.deleteFailedWork(id)`, refresh after success, and use the existing `page-message` live region for success. Do not add a new card or decorative animation.

- [ ] **Step 4: Run renderer tests and commit Task 4**

Run: `npm test -- tests/renderer/works.test.tsx`

Expected: PASS with no act/focus warnings.

```powershell
git add src/renderer/src/features/works/WorkStatusRow.tsx src/renderer/src/pages/WorksPage.tsx src/renderer/src/pages/workspace-pages.css tests/renderer/works.test.tsx
git commit -m "feat: add failed task delete action"
```

---

### Task 5: Full verification and real candidate acceptance

**Files:**
- No source changes expected; fixes must return to the owning task and repeat its reviews.

- [ ] **Step 1: Run full automated verification**

Run:

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: 46+ test files pass with only the existing permission-dependent skip; typecheck/build/diff-check pass.

- [ ] **Step 2: Build an unpacked candidate**

Run: `npm run dist:dir`

Expected: `release/win-unpacked/对标内容雷达.exe` is rebuilt successfully. After packaging, restore the Node test ABI with `npm rebuild better-sqlite3` before any later test run.

- [ ] **Step 3: Perform real-link acceptance**

Start the unpacked candidate with the normal user data. Import the known work containing video ID `7658288075461725474` from a cold process. Success requires a real title, a managed video file, and progression beyond `discovered`; no manual browser capture should be required when the public retry succeeds.

- [ ] **Step 4: Perform deletion acceptance**

Use the candidate to delete one failed placeholder. Confirm the row disappears, related database rows are absent, the other failed/completed rows remain, and no path outside the task's managed directory changed.

- [ ] **Step 5: Final review checkpoint**

Run one final repository-wide spec and quality review over the complete commit range. Do not publish, push, bump the version or install over production during this task.
