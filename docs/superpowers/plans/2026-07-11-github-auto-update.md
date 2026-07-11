# GitHub Releases Automatic Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the app as an MIT-licensed public GitHub project and make packaged Windows builds automatically update from GitHub Releases whenever business work is idle.

**Architecture:** A small main-process `UpdateService` wraps `electron-updater` behind an injected adapter, normalizes updater events, and installs only after a supplied `isBusinessIdle` guard returns true. Typed IPC sends read-only update state to a compact top-bar indicator; release publishing remains outside the client and uses GitHub Releases without embedding credentials.

**Tech Stack:** Electron 43, TypeScript, electron-updater, electron-builder NSIS, React 19, Vitest, GitHub Releases

---

## File map

- Create `src/main/update-service.ts`: updater state machine and idle-safe automatic installation.
- Create `tests/main/update-service.test.ts`: updater event, progress, error, and idle guard tests.
- Modify `src/main/runtime.ts`: expose whether a collection/analysis run is active.
- Modify `src/main/index.ts`: create and start the updater only in packaged builds.
- Modify `src/shared/ipc-contract.ts`, `src/main/ipc.ts`, `src/preload/index.ts`: typed state and subscription IPC.
- Create `src/renderer/src/components/UpdateStatus.tsx`: accessible automatic-update status.
- Create `tests/renderer/update-status.test.tsx`: visible update-state behavior.
- Modify `src/renderer/src/components/Topbar.tsx` and CSS: host update status without competing with the run action.
- Modify `package.json` and `package-lock.json`: dependency and GitHub publish metadata.
- Create `LICENSE` and `README.md`: MIT licensing, installation, security, and platform-use guidance.
- Create `.github/workflows/release.yml`: tagged Windows release build and artifact publishing.

### Task 1: Add updater state machine

**Files:**
- Create: `tests/main/update-service.test.ts`
- Create: `src/main/update-service.ts`

- [ ] **Step 1: Write failing state and install-guard tests**

Define a fake updater adapter with `on`, `checkForUpdatesAndNotify`, and `quitAndInstall`. Assert that `download-progress` becomes `{ status: 'downloading', percent: 42 }`, `update-downloaded` becomes `waiting_for_idle` while `isBusinessIdle()` is false, and installation occurs only after `notifyBusinessIdle()`.

- [ ] **Step 2: Verify RED**

Run `npm test -- --run tests/main/update-service.test.ts`. Expected: FAIL because `src/main/update-service.ts` does not exist.

- [ ] **Step 3: Implement the minimal service**

Use this public shape:

```ts
export type UpdateState =
  | { status: 'idle' | 'checking' | 'up_to_date' | 'installing' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'waiting_for_idle'; version: string }
  | { status: 'error'; message: string }

export class UpdateService {
  start(): Promise<void>
  getState(): UpdateState
  subscribe(listener: (state: UpdateState) => void): () => void
  retry(): Promise<void>
  notifyBusinessIdle(): void
}
```

Clamp progress to 0–100, sanitize errors to a fixed Chinese message, and call `quitAndInstall(false, true)` only when an update is downloaded and the idle guard passes.

- [ ] **Step 4: Verify GREEN**

Run `npm test -- --run tests/main/update-service.test.ts`. Expected: all updater tests PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat: add idle-safe automatic update service"`

### Task 2: Expose runtime idleness and wire production lifecycle

**Files:**
- Modify: `src/main/runtime.ts`
- Modify: `tests/main/runtime.test.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Write a failing runtime-idle test**

Assert `runtime.isBusinessIdle()` is true before a run, false while an injected discovery promise is unresolved, and true after the run settles.

- [ ] **Step 2: Verify RED**

Run `npm test -- --run tests/main/runtime.test.ts`. Expected: FAIL because `isBusinessIdle` is missing.

- [ ] **Step 3: Add idleness and updater lifecycle wiring**

Add `isBusinessIdle(): boolean { return !this.running }`. In `src/main/index.ts`, create `UpdateService` only when `app.isPackaged`; start it after the window is ready, call `notifyBusinessIdle()` after every scheduled/manual run settles, and stop normal resources before updater installation.

- [ ] **Step 4: Verify GREEN**

Run `npm test -- --run tests/main/runtime.test.ts && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat: coordinate updates with desktop work"`

### Task 3: Add typed update IPC

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `tests/main/ipc-contract.test.ts`

- [ ] **Step 1: Write failing contract assertions**

Expect channels `updates:get`, `updates:retry`, and `updates:state-changed`, and expect the preload API to expose `getUpdateState`, `retryUpdate`, and `onUpdateState`.

- [ ] **Step 2: Verify RED**

Run `npm test -- --run tests/main/ipc-contract.test.ts`. Expected: FAIL with missing update channels.

- [ ] **Step 3: Implement constrained IPC**

The renderer may read state, retry checking, and subscribe. Subscription must return `() => ipcRenderer.removeListener(channel, listener)`. It must not accept URLs, paths, tokens, or install commands.

- [ ] **Step 4: Verify GREEN**

Run `npm test -- --run tests/main/ipc-contract.test.ts && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat: expose automatic update status"`

### Task 4: Show non-blocking automatic update status

**Files:**
- Create: `src/renderer/src/components/UpdateStatus.tsx`
- Create: `tests/renderer/update-status.test.tsx`
- Modify: `src/renderer/src/components/Topbar.tsx`
- Modify: `src/renderer/src/components/topbar.css`

- [ ] **Step 1: Write failing UI tests**

Assert downloading displays `正在下载更新 42%`, waiting displays `任务完成后自动更新`, installing displays `正在自动更新`, error displays a `重试更新` button, and idle/up-to-date render no persistent status.

- [ ] **Step 2: Verify RED**

Run `npm test -- --run tests/renderer/update-status.test.tsx`. Expected: FAIL because `UpdateStatus` is missing.

- [ ] **Step 3: Implement the compact indicator**

Subscribe on mount, unsubscribe on unmount, use `aria-live="polite"`, and keep the retry button secondary so “立即运行” remains the primary page action.

- [ ] **Step 4: Verify GREEN**

Run `npm test -- --run tests/renderer/update-status.test.tsx && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat: show automatic update progress"`

### Task 5: Configure GitHub Releases publishing

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Add configuration assertions**

Extend a package/config test to assert publish provider `github`, owner `hongzuoguo`, repo `competitor-content-radar`, and that the release workflow triggers only on `v*` tags.

- [ ] **Step 2: Verify RED**

Run the focused configuration test. Expected: FAIL because publish metadata and workflow are absent.

- [ ] **Step 3: Install and configure release tooling**

Install `electron-updater` as a production dependency. Add `build.publish` GitHub metadata. Add a Windows workflow that runs `npm ci`, tests, typecheck, and `npm run dist -- --publish always` with repository `GITHUB_TOKEN`; never persist the token into files.

- [ ] **Step 4: Verify GREEN**

Run the focused test, `npm run typecheck`, and `npm run build`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "build: publish update artifacts to GitHub"`

### Task 6: Prepare the public open-source repository

**Files:**
- Create: `LICENSE`
- Create: `README.md`
- Audit: `.gitignore`, tracked files, and commit history

- [ ] **Step 1: Add MIT license and README**

Use copyright `2026 hongzuoguo`. Document Windows installation, local SenseVoice model download, supported AI providers, local credential storage, Douyin manual verification, current Feishu limitation, development commands, release tags, and responsible platform use.

- [ ] **Step 2: Audit secrets and private artifacts**

Run `git grep -nEi "(api[_-]?key|token|cookie|authorization)[[:space:]]*[:=][[:space:]]*['\"][^'\"]+"` and inspect every hit. Run `git ls-files` and confirm no database, media, model binary, installer, `.env`, log, or user-data artifact is tracked.

- [ ] **Step 3: Create the public GitHub repository**

Create `hongzuoguo/competitor-content-radar` as public without an auto-generated README, license, or `.gitignore`, then add it as `origin`.

- [ ] **Step 4: Push only after the audit passes**

Push the intended default branch and tags without force. Confirm the GitHub repository visibility is public and the LICENSE/README render correctly.

- [ ] **Step 5: Commit documentation**

`git commit -m "docs: prepare public MIT release"`

### Task 7: Package and prove an actual automatic upgrade

**Files:**
- Generated, ignored: `release/*.exe`, `release/*.blockmap`, `release/latest.yml`

- [ ] **Step 1: Run full verification**

Run `npm test -- --run`, `npm run typecheck`, `npm run build`, and `git diff --check`. Expected: zero failures.

- [ ] **Step 2: Build the updater-enabled installer**

Build Windows NSIS x64 and confirm the release directory contains the installer, blockmap, and `latest.yml` with the correct version and SHA-512 metadata.

- [ ] **Step 3: Smoke-test the packaged executable**

Launch `release/win-unpacked/对标内容雷达.exe`, verify it remains alive, then close the test process. Restore the Node ABI for `better-sqlite3` and rerun the full tests.

- [ ] **Step 4: Publish two sequential test releases**

Publish the updater-enabled baseline release, install it, then publish a higher patch version. Verify the installed baseline automatically downloads and restarts into the higher version while preserving a known creator record and settings value.

- [ ] **Step 5: Record evidence**

Report the repository URL, release URLs, installer hashes, test counts, automatic upgrade result, and any unsigned-binary SmartScreen warning.
