# Subscription Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the confirmed desktop subscription workspace that discovers creator updates at 08:00, evaluates viral signals against a 30-work baseline, and exposes transcripts plus AI breakdowns in one three-pane workflow.

**Architecture:** Reuse the existing SQLite works, snapshots, analyses, highlight rules, five-day selector, and creator management. Extend the runtime with persistent run state and a typed work-detail query, then replace only the Works page presentation with the confirmed master-detail layout. Discovery remains usable without an AI provider; transcription/analysis is skipped with an explicit state when configuration is missing.

**Tech Stack:** Electron 43, React 19, TypeScript, better-sqlite3, Vitest, Testing Library, existing IPC/preload bridge and CSS tokens.

---

### Task 0: Accept creator profile links, short links, and complete share messages

**Status:** Implemented by the public-share resolver work; this task is an integration prerequisite and must not duplicate or replace that implementation.

**Files:**
- Verify: `src/services/douyin/public-share-resolver.ts`
- Verify: `src/main/runtime.ts`
- Test: `tests/services/douyin-public-share-resolver.test.ts`
- Test: `tests/main/runtime.test.ts`

- [ ] **Step 1: Verify all accepted creator input forms**

Confirm the existing creator-add path accepts:

```text
https://www.douyin.com/user/<creator-id>
https://v.douyin.com/<short-code>/
3- 长按复制此条消息，打开抖音搜索，查看TA的更多作品。 https://v.douyin.com/<short-code>/ 2@9.com :0pm
```

The resolver must extract the URL from surrounding share text, follow only safe HTTP(S) redirects, require a Douyin destination, and return the canonical `/user/...` profile URL.

- [ ] **Step 2: Run focused acceptance checks**

Run: `npm test -- tests/services/douyin-public-share-resolver.test.ts tests/main/runtime.test.ts`

Expected: direct profile links, short links, and complete creator-card share messages resolve to the same normalized creator URL; unsafe or non-creator destinations are rejected with the existing stable error.

- [ ] **Step 3: Preserve the implementation boundary**

Do not add a second short-link resolver or a renderer-only parser. The subscription workspace must call the existing `addCreator` runtime path so creator identity normalization remains centralized.

### Task 1: Persist 08:00 scheduling and make discovery independent

**Files:**
- Modify: `src/main/scheduler.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/runtime.ts`
- Modify: `src/services/database/repositories.ts`
- Test: `tests/main/scheduler.test.ts`
- Test: `tests/main/runtime.test.ts`
- Test: `tests/services/database.test.ts`

- [ ] **Step 1: Write failing scheduler tests**

Change the daily expectations from 09:00 to 08:00 China time and add a catch-up case for an app launched after 08:00.

```ts
expect(nextDailyRun(new Date('2026-07-11T00:30:00.000Z')).toISOString())
  .toBe('2026-07-12T00:00:00.000Z')
expect(shouldRunCatchUp(new Date('2026-07-10T00:00:00.000Z'), new Date('2026-07-11T01:00:00.000Z'), false))
  .toBe(true)
```

- [ ] **Step 2: Write failing runtime tests**

Cover these behaviors separately:

```ts
it('stores discovered works when no AI provider is configured')
it('continues after one work analysis fails')
it('continues after one creator discovery fails')
it('persists the completed daily run used by startup catch-up')
```

- [ ] **Step 3: Run RED checks**

Run: `npm test -- tests/main/scheduler.test.ts tests/main/runtime.test.ts tests/services/database.test.ts`

Expected: the new 08:00, discovery-only, partial-run and persisted-last-run assertions fail.

- [ ] **Step 4: Implement minimal scheduling and run lifecycle**

In `scheduler.ts`, make the fixed daily hour 08:00. Add `RunRepository.latestCompletedDaily()` using `finished_at DESC LIMIT 1`. In startup, pass that timestamp to `scheduler.start()` instead of `null`.

In `DesktopRuntime.runNow()` remove the AI-provider precondition. In `executeRun()`:

```ts
const canAnalyze = Boolean(settings.providerId && settings.modelId)
for (const creator of creators) {
  try {
    const discovered = selectBaselineWorks(await ports.discover(creator.id, creator.profileUrl))
    // upsert all 30 and save snapshots
    if (canAnalyze) {
      for (const work of selectRecentWorks(discovered)) {
        try { await processAndSave(work, settings) } catch { partial = true }
      }
    } else {
      partial = true
    }
  } catch { partial = true }
}
// save run as completed or partial with finishedAt
```

Only catch per creator and per analysis item. Preserve the existing outer catch for fatal database/runtime failures.

- [ ] **Step 5: Run GREEN checks and commit**

Run: `npm test -- tests/main/scheduler.test.ts tests/main/runtime.test.ts tests/services/database.test.ts`

Run: `npm run typecheck`

Commit: `feat: persist daily subscription runs`

### Task 2: Expose typed work details and live monitor updates

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/main/runtime.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/main/runtime.test.ts`
- Test: `tests/main/ipc-contract.test.ts`
- Test: `tests/main/preload-work-events.test.ts`

- [ ] **Step 1: Write failing contract tests**

Define `WorkDetail` with the fields required by the right pane:

```ts
export interface WorkDetail extends WorkListItem {
  originalUrl: string | null
  comments: number
  shares: number
  collects: number
  transcript: string | null
  analysis: AnalysisResult | null
  analysisProvider: string | null
  analyzedAt: string | null
}
```

Add `workGet: 'works:get'`, `desktopApi.getWork(id)`, and verify the preload invokes the exact channel.

- [ ] **Step 2: Write failing runtime mapping tests**

Assert a known work maps to its transcript, parsed analysis, source URL and full metrics; unknown IDs return `null`. Assert monitor upserts notify `onWorkStateChanged` listeners, not just manual imports.

- [ ] **Step 3: Run RED checks**

Run: `npm test -- tests/main/runtime.test.ts tests/main/ipc-contract.test.ts tests/main/preload-work-events.test.ts`

- [ ] **Step 4: Implement the minimal query and event bridge**

Add `DesktopRuntime.getWork(id)` by reading the existing works, jobs, artifacts and analyses repositories. Extend the existing runtime listener set so both import-service events and monitor-run upserts call the same callback. Register the IPC handler and preload method without introducing a second event channel.

- [ ] **Step 5: Run GREEN checks and commit**

Run: `npm test -- tests/main/runtime.test.ts tests/main/ipc-contract.test.ts tests/main/preload-work-events.test.ts`

Run: `npm run typecheck`

Commit: `feat: expose subscription work details`

### Task 3: Build the three-pane subscription workspace behavior

**Files:**
- Modify: `src/renderer/src/pages/WorksPage.tsx`
- Create: `src/renderer/src/features/works/CreatorRail.tsx`
- Create: `src/renderer/src/features/works/SubscriptionWorkList.tsx`
- Create: `src/renderer/src/features/works/WorkInspector.tsx`
- Test: `tests/renderer/works.test.tsx`
- Test: `tests/renderer/subscription-workspace.test.tsx`

- [ ] **Step 1: Write failing renderer tests**

Cover user-visible behavior:

```ts
it('selects the first enabled creator and newest work')
it('filters the middle list to the selected creator')
it('shows high-like, relative-viral and reference-value labels')
it('loads the selected transcript and six analysis sections')
it('shows a useful waiting state when AI is not configured')
it('refreshes without losing the selected work when work state changes')
```

- [ ] **Step 2: Run RED check**

Run: `npm test -- tests/renderer/works.test.tsx tests/renderer/subscription-workspace.test.tsx`

- [ ] **Step 3: Implement focused components**

`CreatorRail` receives creators, selected ID and selection callback. Its add action navigates to `/creators`; it does not duplicate the existing creator form.

`SubscriptionWorkList` receives works for one creator, groups by local calendar day, and implements three filters: `all`, `worthwhile` (any reason), and `viral` (`relative_viral`). Rows remain native buttons and expose `aria-pressed`.

`WorkInspector` requests `getWork(selectedWorkId)` and renders:

- metrics with an adjacent reason sentence;
- tabs for `AI 拆解`, `完整文案`, `数据趋势`;
- six analysis sections mapped from `topicAngle`, `openingHook`, `structure`, `viralPoints`, `interactionGuidance`, and `highlights/reusablePatterns`;
- explicit loading, missing-analysis and failed states.

Keep the existing import dialog reachable from the page heading.

- [ ] **Step 4: Run GREEN check and commit**

Run: `npm test -- tests/renderer/works.test.tsx tests/renderer/subscription-workspace.test.tsx`

Commit: `feat: add subscription analysis workspace`

### Task 4: Apply the confirmed desktop visual system and accessibility states

**Files:**
- Modify: `src/renderer/src/pages/workspace-pages.css`
- Modify: `src/renderer/src/styles/tokens.css` only if an existing semantic state token is missing
- Test: `tests/renderer/subscription-workspace.test.tsx`

- [ ] **Step 1: Add failing semantic/accessibility assertions**

Assert named regions for subscribed creators, work list and work detail; keyboard-selectable rows; visible status text independent of color; loading skeletons; and tab semantics.

- [ ] **Step 2: Implement the confirmed layout**

Use the existing mineral-teal tokens and 1px separators. Desktop grid target:

```css
.subscription-workspace {
  display: grid;
  grid-template-columns: 220px 340px minmax(460px, 1fr);
  min-height: 0;
}
```

At narrower desktop widths, reduce the creator rail and work list before allowing horizontal overflow. Do not add gradients, glass, colored side stripes, nested card grids or decorative motion. Add `:focus-visible` and `prefers-reduced-motion` handling.

- [ ] **Step 3: Verify and commit**

Run: `npm test -- tests/renderer/subscription-workspace.test.tsx`

Run: `npm run typecheck`

Commit: `style: polish subscription workspace`

### Task 5: Trigger first capture after subscription and verify end to end

**Files:**
- Modify: `src/main/runtime.ts`
- Modify: `src/renderer/src/pages/CreatorsPage.tsx` only if status copy needs adjustment
- Test: `tests/main/runtime.test.ts`
- Test: `tests/renderer/creators.test.tsx`

- [ ] **Step 1: Write failing first-subscription test**

After `addCreator(url)`, assert the creator is saved before a background `runNow()` is requested. If another run is active, the creator remains saved and is picked up by the next scheduled/catch-up run.

- [ ] **Step 2: Implement the minimal trigger**

Start one non-blocking run after successful creator creation. Do not make the add action wait for network discovery. Emit monitor work events as each baseline work is persisted so the workspace fills progressively.

- [ ] **Step 3: Run full verification**

Run: `npm test`

Expected: all tests pass; only the documented Windows permission skip may remain.

Run: `npm run typecheck`

Run: `npm run build`

- [ ] **Step 4: Visual verification**

Launch the desktop dev build at 1600×1000 and 1366×768. Verify creator selection, work selection, all three detail tabs, empty/loading/failure states, long Chinese titles, and keyboard focus. Capture a final screenshot for user acceptance.

- [ ] **Step 5: Package candidate and commit**

Run: `npm run dist:dir`

Launch: `release/win-unpacked/对标内容雷达.exe`

Commit: `feat: complete desktop subscription workflow`

## Self-review

- Spec coverage: creator profile links, short links and complete share messages; 30-work baseline; five-day processing; 08:00 scheduling; catch-up; absolute and relative rules; transcripts; six-part AI detail; model-independent discovery; failure isolation and desktop responsiveness are each assigned to a task.
- Placeholder scan: no TBD/TODO/“similar to” steps.
- Type consistency: `WorkDetail`, `getWork`, existing `WorkListItem`, `AnalysisResult`, and the existing `workStateChanged` event are used consistently across runtime, IPC, preload and renderer.
