# Douyin System Browser Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Electron-embedded Douyin login and capture window with a Chrome-first, Edge-fallback, application-owned real browser session that preserves login, captures the same public data, and stops safely on risk control.

**Architecture:** A locator finds an installed Chrome or Edge executable. A process controller launches that browser with an application-only user-data directory, a loopback-only dynamic DevTools port, and a visible window for login or a minimized visible window for collection. `DouyinBrowserSession` serializes all access to the profile, connects through Chrome DevTools Protocol, verifies login from strong session evidence, and reuses the existing response parsers without importing the user's normal browser data.

**Tech Stack:** TypeScript, Electron 43, Node.js child processes/filesystem, `chrome-remote-interface@0.34.0`, Vitest, React Testing Library, electron-builder.

---

## File map

- Create `src/services/douyin/browser-locator.ts`: find Chrome first and Edge second without touching user profiles.
- Create `src/services/douyin/browser-process.ts`: start/stop a browser, wait for `DevToolsActivePort`, and expose a loopback CDP endpoint.
- Create `src/services/douyin/cdp-page.ts`: own one CDP page, navigation, response-body capture, page text, and auth-cookie checks.
- Modify `src/services/douyin/session.ts`: serialize login/capture operations and replace Electron `BrowserWindow` usage.
- Modify `src/main/production-runtime.ts`: pass the application-owned profile path and close the browser session before the database.
- Modify `src/main/runtime.ts`: save `douyinLoggedIn=true` only after verified login and clear it when capture proves the session expired.
- Modify `README.md`: document Chrome/Edge login, the dedicated profile, and risk-control behavior.
- Add focused tests under `tests/services/` and `tests/main/` for discovery, process lifecycle, login, capture, shutdown, and logging safety.

## Task 1: Locate Chrome first and Edge second

**Files:**
- Create: `src/services/douyin/browser-locator.ts`
- Test: `tests/services/douyin-browser-locator.test.ts`

- [ ] **Step 1: Write failing browser priority and absence tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import { findSystemBrowser } from '../../src/services/douyin/browser-locator'

describe('findSystemBrowser', () => {
  it('prefers Chrome when Chrome and Edge are installed', () => {
    const exists = vi.fn((path: string) => path.endsWith('chrome.exe') || path.endsWith('msedge.exe'))
    expect(findSystemBrowser({
      env: { LOCALAPPDATA: 'C:/Local', PROGRAMFILES: 'C:/Program Files', 'PROGRAMFILES(X86)': 'C:/Program Files (x86)' },
      exists,
      readAppPath: vi.fn(() => null)
    })).toMatchObject({ kind: 'chrome', executablePath: 'C:/Local/Google/Chrome/Application/chrome.exe' })
  })

  it('uses Edge when Chrome is unavailable', () => {
    const exists = vi.fn((path: string) => path.endsWith('msedge.exe'))
    expect(findSystemBrowser({
      env: { LOCALAPPDATA: 'C:/Local', PROGRAMFILES: 'C:/Program Files', 'PROGRAMFILES(X86)': 'C:/Program Files (x86)' },
      exists,
      readAppPath: vi.fn(() => null)
    })).toMatchObject({ kind: 'edge' })
  })

  it('returns null when neither supported browser exists', () => {
    expect(findSystemBrowser({ env: {}, exists: () => false, readAppPath: () => null })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the locator tests and verify RED**

Run: `npm test -- tests/services/douyin-browser-locator.test.ts`

Expected: FAIL because `browser-locator.ts` does not exist.

- [ ] **Step 3: Implement deterministic discovery**

Define the public contract exactly:

```ts
export type SystemBrowserKind = 'chrome' | 'edge'

export interface SystemBrowserInstallation {
  kind: SystemBrowserKind
  executablePath: string
}

export interface BrowserLocatorDependencies {
  env: NodeJS.ProcessEnv
  exists(path: string): boolean
  readAppPath(executableName: 'chrome.exe' | 'msedge.exe'): string | null
}

export function findSystemBrowser(dependencies?: Partial<BrowserLocatorDependencies>): SystemBrowserInstallation | null
```

Search Chrome candidates before every Edge candidate. For each browser, check the per-user path, 64-bit Program Files, 32-bit Program Files, then the Windows `App Paths` registry result supplied by `readAppPath`. Normalize and deduplicate candidates, accept files only, and never inspect a browser's default user-data directory. The production `readAppPath` must call `reg.exe query` with `execFileSync` argument arrays and return `null` on any error; it must not build a shell command string.

- [ ] **Step 4: Add registry fallback and malformed-output tests**

Add assertions that a valid `App Paths` value is accepted, an empty/malformed registry result is ignored, and a quoted path is normalized without accepting extra command-line arguments.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- tests/services/douyin-browser-locator.test.ts`

Expected: PASS.

```powershell
git add src/services/douyin/browser-locator.ts tests/services/douyin-browser-locator.test.ts
git commit -m "feat: locate installed browser for Douyin"
```

## Task 2: Launch an isolated loopback-only browser process

**Files:**
- Create: `src/services/douyin/browser-process.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/services/douyin-browser-process.test.ts`

- [ ] **Step 1: Install the CDP client dependency**

Run: `npm install chrome-remote-interface@0.34.0 @types/chrome-remote-interface@0.34.0`

Expected: `package.json` and `package-lock.json` contain exact compatible `0.34.0` entries and no Chromium download occurs.

- [ ] **Step 2: Write failing process argument and readiness tests**

```ts
it('launches with an isolated profile and a loopback dynamic port', async () => {
  const spawned = fakeChildProcess()
  const controller = new SystemBrowserProcess({
    spawn: vi.fn(() => spawned.child),
    readFile: vi.fn().mockResolvedValue('43117\n/devtools/browser/id\n'),
    mkdir: vi.fn(), rm: vi.fn(), wait: immediateWait
  })
  const running = await controller.start({
    installation: { kind: 'chrome', executablePath: 'C:/Chrome/chrome.exe' },
    userDataDirectory: 'C:/AppData/douyin-browser', mode: 'login'
  })
  expect(running.endpoint).toEqual({ host: '127.0.0.1', port: 43117 })
  expect(controller.lastArguments()).toEqual(expect.arrayContaining([
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--user-data-dir=C:/AppData/douyin-browser'
  ]))
})
```

Also cover malformed `DevToolsActivePort`, process exit before readiness, timeout, an already-locked profile, and `mode: 'capture'` adding `--start-minimized` but never `--headless`.

- [ ] **Step 3: Run process tests and verify RED**

Run: `npm test -- tests/services/douyin-browser-process.test.ts`

Expected: FAIL because the process controller does not exist.

- [ ] **Step 4: Implement the process lifecycle**

Export these contracts:

```ts
export interface BrowserEndpoint { host: '127.0.0.1'; port: number }
export interface RunningSystemBrowser {
  endpoint: BrowserEndpoint
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  close(): Promise<void>
}

export class SystemBrowserProcess {
  start(input: {
    installation: SystemBrowserInstallation
    userDataDirectory: string
    mode: 'login' | 'capture'
  }): Promise<RunningSystemBrowser>
}
```

Before spawning, create the dedicated directory and remove only its stale `DevToolsActivePort` file. Use `spawn(executablePath, args, { shell: false, windowsHide: false, stdio: 'ignore' })`. Use `--no-first-run`, `--no-default-browser-check`, `--disable-background-mode`, the loopback/debug/profile arguments above, and `https://www.douyin.com/` for login or `about:blank` for capture. Poll the port file for at most 15 seconds while racing process exit. Accept only an integer port from 1 through 65535. Never log the second line, cookies, command URLs, or profile contents.

`close()` must be idempotent: request graceful termination, wait up to five seconds, then kill the owned child only. It must never enumerate or terminate unrelated Chrome/Edge processes.

- [ ] **Step 5: Add shutdown and ownership tests**

Verify two `close()` calls are safe, graceful exit does not call `kill()` twice, timeout kills only the injected child, and readiness failure closes the child and removes the stale port file.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- tests/services/douyin-browser-process.test.ts tests/services/douyin-browser-locator.test.ts`

Expected: PASS.

```powershell
git add package.json package-lock.json src/services/douyin/browser-process.ts tests/services/douyin-browser-process.test.ts
git commit -m "feat: manage isolated Douyin browser process"
```

## Task 3: Wrap CDP page operations and verified login

**Files:**
- Create: `src/services/douyin/cdp-page.ts`
- Modify: `src/services/douyin/session.ts`
- Test: `tests/services/douyin-system-session.test.ts`
- Test: `tests/services/douyin-session-guards.test.ts`

- [ ] **Step 1: Write failing CDP navigation and authentication tests**

Create a fake `chrome-remote-interface` client and assert:

```ts
it('requires a strong Douyin auth cookie before login succeeds', async () => {
  cdp.Storage.getCookies
    .mockResolvedValueOnce({ cookies: [{ name: 'passport_csrf_token', domain: '.douyin.com' }] })
    .mockResolvedValueOnce({ cookies: [{ name: 'sessionid_ss', domain: '.douyin.com' }] })
  await expect(page.waitForVerifiedLogin({ timeoutMs: 5_000 })).resolves.toBeUndefined()
})

it('does not accept window close as successful login', async () => {
  cdp.Storage.getCookies.mockResolvedValue({ cookies: [] })
  browser.resolveExit({ code: 0, signal: null })
  await expect(session.openLoginWindow()).rejects.toMatchObject({ code: 'DOUYIN_LOGIN_INCOMPLETE' })
})
```

Strong cookies are `sessionid`, `sessionid_ss`, `sid_guard`, or `sid_tt` on `douyin.com` or a subdomain. `passport_csrf_token` alone is insufficient. Risk-control text must fail with `DOUYIN_RISK_CONTROL`, `retryable:false` and stop polling.

- [ ] **Step 2: Run session tests and verify RED**

Run: `npm test -- tests/services/douyin-system-session.test.ts tests/services/douyin-session-guards.test.ts`

Expected: FAIL because the session still constructs Electron `BrowserWindow`.

- [ ] **Step 3: Implement a focused CDP page wrapper**

Export:

```ts
export interface CapturedJsonResponse { url: string; body: string }

export class DouyinCdpPage {
  static connect(endpoint: BrowserEndpoint): Promise<DouyinCdpPage>
  navigate(url: string, timeoutMs: number): Promise<void>
  readBodyText(limit?: number): Promise<string>
  hasVerifiedLogin(): Promise<boolean>
  onJsonResponse(listener: (response: CapturedJsonResponse) => void): () => void
  close(): Promise<void>
}
```

Create or reuse a single page target, enable `Page`, `Network`, `Runtime`, and `Storage`, then register response listeners before navigation. `onJsonResponse` must filter with the existing `isDouyinJsonResponse`, read response bodies with a ten-second timeout, isolate body-read/JSON failures, and return an unsubscribe function. Never expose headers or cookies to logs.

- [ ] **Step 4: Replace embedded login with serialized system-browser login**

Change the constructor to accept explicit dependencies for tests and a production default:

```ts
export interface DouyinBrowserSessionOptions {
  userDataDirectory: string
  locateBrowser?: typeof findSystemBrowser
  processFactory?: () => SystemBrowserProcess
  connectPage?: typeof DouyinCdpPage.connect
  report?: (level: 'info' | 'warn' | 'error', message: string, detail?: Record<string, unknown>) => void
}
```

`openLoginWindow()` must run through a private FIFO serializer, fail with `DOUYIN_BROWSER_NOT_FOUND` when neither browser exists, start in login mode, wait up to five minutes for verified login while racing owned-process exit, and close the owned browser after success or failure. Report browser kind and stable error code only. Do not report executable paths, profile paths, port, page text, cookie names, or cookie values.

- [ ] **Step 5: Add serialization and sanitized logging tests**

Start login and capture concurrently and assert the second operation does not call `start()` until the first releases the profile. Verify a thrown error/log record contains only `browserKind` and `errorCode`, and that closing the app rejects queued work with `APP_SHUTTING_DOWN`.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- tests/services/douyin-system-session.test.ts tests/services/douyin-session-guards.test.ts`

Expected: PASS.

```powershell
git add src/services/douyin/cdp-page.ts src/services/douyin/session.ts tests/services/douyin-system-session.test.ts tests/services/douyin-session-guards.test.ts
git commit -m "feat: verify Douyin login in system browser"
```

## Task 4: Migrate creator and single-video capture

**Files:**
- Modify: `src/services/douyin/session.ts`
- Test: `tests/services/douyin-system-capture.test.ts`
- Test: `tests/services/douyin-discovery.test.ts`
- Test: `tests/services/import-douyin-video.test.ts`

- [ ] **Step 1: Write failing creator-capture tests**

```ts
it('captures creator JSON responses through the real-browser page adapter', async () => {
  const page = fakeDouyinPage()
  const pending = session.captureCreatorWorks('creator-1', profileUrl)
  page.emitJson('https://www.douyin.com/aweme/v1/web/aweme/post/', creatorPayload)
  await expect(pending).resolves.toEqual(expect.arrayContaining([
    expect.objectContaining({ creatorId: 'creator-1', platformWorkId: '7658' })
  ]))
})
```

Add cases for expired login (`DOUYIN_LOGIN_REQUIRED`), risk-control page/JSON (`DOUYIN_RISK_CONTROL`, no automatic navigation retry), browser crash (`DOUYIN_BROWSER_EXITED`, retryable), load timeout, empty capture, and duplicate response payloads.

- [ ] **Step 2: Write failing single-video capture tests**

Verify the canonical URL invariant, target video ID matching, public media URL extraction, response-body completion before return, risk-control returning `null` for the existing adapter contract, and no capture from non-Douyin hosts.

- [ ] **Step 3: Run capture tests and verify RED**

Run: `npm test -- tests/services/douyin-system-capture.test.ts tests/services/douyin-discovery.test.ts tests/services/import-douyin-video.test.ts`

Expected: FAIL because creator and single-video capture still use Electron debugger APIs.

- [ ] **Step 4: Implement both capture paths on the serialized profile**

For each operation, find the browser, start in capture mode, connect a page, register JSON capture before navigation, navigate once, wait up to eight seconds for relevant responses, drain pending body reads, then inspect body text for risk control. Before navigation, call `hasVerifiedLogin()`; if false, stop without visiting the creator/video URL and throw `DOUYIN_LOGIN_REQUIRED`.

Reuse `extractWorksFromPayload`, `extractWorkFromPayload`, `deduplicateWorks`, `normalizeCreatorUrl`, `isRiskControlText`, and `isDouyinJsonResponse`. Do not add scrolling, refresh loops, fingerprint spoofing, captcha automation, or retry-on-risk behavior.

- [ ] **Step 5: Verify resource cleanup for every terminal path**

Tests must assert that listener unsubscribe, CDP page close, and owned browser close each run exactly once on success, parse failure, timeout, risk control, process exit, and app shutdown.

- [ ] **Step 6: Run focused and existing Douyin tests**

Run: `npm test -- tests/services/douyin-system-capture.test.ts tests/services/douyin-session-guards.test.ts tests/services/douyin-discovery.test.ts tests/services/import-douyin-video.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/services/douyin/session.ts tests/services/douyin-system-capture.test.ts tests/services/douyin-discovery.test.ts tests/services/import-douyin-video.test.ts
git commit -m "feat: capture Douyin through system browser"
```

## Task 5: Integrate shutdown, settings, documentation, and release verification

**Files:**
- Modify: `src/main/production-runtime.ts`
- Modify: `src/main/runtime.ts`
- Modify: `src/renderer/src/features/settings/ConnectionSettings.tsx`
- Modify: `README.md`
- Test: `tests/main/production-runtime.test.ts`
- Test: `tests/main/runtime.test.ts`
- Test: `tests/renderer/settings.test.tsx`

- [ ] **Step 1: Write failing production wiring and shutdown tests**

Assert the session receives `join(app.getPath('userData'), 'douyin-browser-profile')`, `ProductionRuntime.close()` waits for `douyin.close()` before closing SQLite, an in-flight login/capture is drained, and queued operations are rejected after shutdown begins.

- [ ] **Step 2: Write failing login-setting tests**

```ts
it('marks Douyin connected only after verified login', async () => {
  ports.login.mockRejectedValueOnce(Object.assign(new Error(), { code: 'DOUYIN_LOGIN_INCOMPLETE' }))
  await expect(runtime.loginDouyin()).rejects.toMatchObject({ code: 'DOUYIN_LOGIN_INCOMPLETE' })
  expect((await runtime.getSettings()).douyinLoggedIn).not.toBe(true)
})
```

Add a test that `DOUYIN_LOGIN_REQUIRED` during scheduled capture clears `douyinLoggedIn` and exposes the existing actionable service state without erasing creator or work history.

- [ ] **Step 3: Implement production wiring and connection copy**

Construct `DouyinBrowserSession` with the dedicated profile path and sanitized logger. Add `close(): Promise<void>` to the session and await it from production runtime shutdown before closing the database. Update settings copy to say “Chrome/Edge 扫码登录” and “应用使用独立浏览器会话，不读取你的日常浏览器资料”. Keep the existing primary action; do not add browser selection settings because priority is confirmed and fixed.

- [ ] **Step 4: Update README accurately**

Replace “独立窗口扫码” with Chrome-first/Edge-fallback behavior. Document the app-owned browser profile, one-time login reuse, visible/minimized controlled windows, risk-control stop behavior, and that the app cannot bypass account/IP/device restrictions. Do not document debug ports, cookie names, or any secret-bearing path.

- [ ] **Step 5: Run complete automated verification**

Run in this order:

```powershell
npm test
npm run typecheck
npm run build
npm audit --omit=dev
git diff --check
git status --short
```

Expected: all tests pass except the existing permission-gated file-symlink test; typecheck/build/diff-check pass; production audit reports zero known vulnerabilities; only intentional files are changed before commit.

- [ ] **Step 6: Commit integration and documentation**

```powershell
git add src/main/production-runtime.ts src/main/runtime.ts src/renderer/src/features/settings/ConnectionSettings.tsx README.md tests/main/production-runtime.test.ts tests/main/runtime.test.ts tests/renderer/settings.test.tsx
git commit -m "feat: integrate system browser Douyin session"
```

- [ ] **Step 7: Build an unpublished Windows candidate**

Run: `npm run dist`

Expected: `release/win-unpacked/对标内容雷达.exe`, installer, blockmap, and `latest.yml` exist. Inspect ASAR/unpacked contents and verify `chrome-remote-interface` is packaged; no Chrome/Edge executable or user profile is bundled.

- [ ] **Step 8: Perform manual acceptance before any version bump or release**

Using the unpublished candidate and an isolated test application user-data directory:

1. With Chrome installed, click login, scan once, confirm the controlled Chrome window closes after verified login, restart the app, and capture one creator.
2. On a machine or controlled test where Chrome discovery is unavailable, confirm Edge is selected.
3. Close the login browser before scanning and confirm the app remains disconnected with a Chinese retry message.
4. Trigger or observe a Douyin risk-control page and confirm there is no automatic refresh/retry.
5. Import one canonical Douyin video URL and verify capture reaches the existing import pipeline.
6. Exit the app during login/capture and confirm only the app-owned browser process closes and the database remains healthy.

Do not bump the version, tag, push, publish, or replace the installed production app until all six checks pass and the existing manual-import Task 9 checks also pass.
