# Persistent Electron Preview

Persistent Electron Preview is a fast, long-lived desktop verification environment. It is separate from Node Dev and from disposable formal `release:local` acceptance. Preview accelerates UI, native-window, menu, zoom, preload, IPC, and ordinary main-process checks; it never proves clean reproducibility.

## Portable roots

The logical roles are `<repo-root>`, `<external-preview-root>`, `<external-build-root>`, and `<external-test-root>`. Assign each to an ordinary directory on your machine before running commands. The following valid example paths are deliberately generic; replace them for your installation rather than using angle-bracket text as a command argument.

Before `git worktree add`, `<external-preview-root>` must be outside `<repo-root>`, every checkout, and every registered Git worktree. It must have no overlap or ancestor-descendant relationship with any of them, and must be an ordinary non-reparse directory; stop if those conditions cannot be proved.

```powershell
$repoRoot = 'D:\HitMuse\source'
$previewRoot = 'D:\HitMuse\preview'
$previewWorktree = Join-Path $previewRoot 'app'
$previewState = Join-Path $previewRoot 'state\preview-state.json'
$previewUserData = Join-Path $previewRoot 'user-data'
$buildRoot = 'D:\HitMuse\build'
$testRoot = 'D:\HitMuse\test'
```

Preview state and user data stay below `$previewRoot`, outside `$previewWorktree`. Closing Electron does not remove the persistent Preview environment.

## Hard boundaries

- Preview is Electron ABI only and owns its own real `node_modules`.
- Do not use a junction, symlink, or borrowed dependency tree; Node Dev, Preview, and formal release never share dependencies or ABI outputs.
- Use isolated Preview user data. Do not read or write formal user data.
- Do not run the ordinary full Node test suite in Preview.
- Preview is never an installer source, `dist:dir` source, packaged-smoke source, clean-room acceptance input, or completeness verdict.
- Preview dependencies, SenseVoice, Scrapling, generated resources, and caches are never a `release:local` fallback.

The source checkout stays Node ABI. Formal packaging is disposable and remains governed by [`build-and-clean-test.md`](./build-and-clean-test.md).

## Initialize from an exact commit

Preview mirrors one full source commit and contains no user-authored source changes. After setting the variables above, use the target full SHA:

```powershell
$commit = git -C $repoRoot rev-parse HEAD
git -C $repoRoot worktree add --detach $previewWorktree $commit
Set-Location $previewWorktree
$env:HITMUSE_INSTALL_RUNTIME = 'electron'
npm ci
Remove-Item Env:HITMUSE_INSTALL_RUNTIME
```

Then verify Electron and its expected ABI, probe `better-sqlite3`, `nodejieba`, and every required native dependency, and prepare Preview resources only through tracked project preparation logic. Verify resource version, byte count, and SHA-256 against the selected commit's manifests before launch. Record state outside the worktree, then launch with the dedicated user-data directory.

The external state record includes at least the target full SHA, resolved worktree path, `package.json` and `package-lock.json` SHA-256, Electron version and ABI, native dependency versions, resource-manifest hashes, Electron executable path, main PID/start time, child PIDs, and Preview user-data path.

## Update and dependency reuse

To move from commit A to commit B, stop only the recorded Preview process tree, confirm the Preview worktree has no unexpected tracked changes, resolve B's full SHA, compare stored and target fingerprints, detach Preview at B, probe Electron/native modules, refresh changed resources, update external state, and relaunch. Never switch a user's development checkout to update Preview.

```powershell
$targetCommit = git -C $repoRoot rev-parse HEAD
git -C $previewWorktree checkout --detach $targetCommit
```

Reuse Preview `node_modules` only when `package-lock.json`, Electron version/ABI, native dependency versions, dependency layout, and Electron-native preparation logic remain compatible, and native probes pass. Renderer, CSS, TSX, ordinary business logic, and ordinary main-process changes do not alone require installation.

Run a fresh Preview-local `npm ci` when the lockfile, install-related package fields, Electron version/ABI, native dependency version, native preparation logic, or a native-module probe changes. First stop and validate the owned process tree; delete only Preview-owned dependencies. Never switch the source checkout's ABI.

Verified resources may be reused only when the selected commit's manifest version, byte count, and SHA-256 remain unchanged. A changed manifest requires re-fetching and re-verifying that resource; partial or failed downloads are never promoted.

## Process ownership and removal

Each launch records the main Electron PID, start time, executable path, and descendants. On stop or restart, revalidate PID start time and executable path, request graceful shutdown, wait while refreshing descendants, and only after timeout terminate the validated Preview-owned tree. Confirm no owned process or handle still references Preview before rebuilding dependencies or removing paths.

Never kill by global process name and never target an Electron process outside the recorded Preview tree. Do not remove Preview after ordinary use. Recreate it only on explicit request, corruption, an unprovable clean state, unrecoverable dependency state, or an obsolete tooling contract. Reparse points, ownership mismatch, PID reuse, unknown files, and unresolved locks are fail-safe: retain the path and report the blocker.

## Formal release boundary

A successful Preview launch is not acceptance evidence. Formal release creates its own disposable worktree, runs fresh dependencies and resource verification, packages and verifies the app, stores only verified external artifacts, and cleans only its own temporary state. It never searches `<external-preview-root>`, `$previewWorktree\node_modules`, Preview user data, or Preview resources as a fallback.
