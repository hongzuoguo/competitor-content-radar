# Optional Scrapling Engine Implementation Plan

**Goal:** Add a secure, on-demand Scrapling fallback component that an installed desktop app can download and invoke without requiring Python.

**Architecture:** The existing Electron collector remains primary. A component manager downloads a versioned, checksummed Windows engine only when eligible primary capture fails. A strict JSON-line runner converts the engine response into existing `Work` records. The Python sidecar uses Scrapling DynamicFetcher with system Chrome/Edge and is independently built and released.

**Tech stack:** TypeScript, Electron, Vitest, Python, Scrapling, PyInstaller, GitHub Actions.

## Task 1: Define and validate the component manifest

- Add failing tests for HTTPS/host allowlist, protocol version, SHA-256 and size.
- Implement the minimal manifest schema and stable error codes.
- Run focused tests and commit.

## Task 2: Download and atomically install the component

- Add failing tests for cache hit, download, hash mismatch, ZIP traversal, health-check failure and atomic activation.
- Implement bounded download, safe extraction, version directories and `current.json` activation.
- Run focused tests and commit.

## Task 3: Implement the JSON-line engine runner

- Add failing tests for request format, output validation, timeout, nonzero exit and sanitized diagnostics.
- Implement fixed executable invocation with no shell and bounded output.
- Run focused tests and commit.

## Task 4: Build the Scrapling engine

- Add Python tests for input validation, browser selection and Douyin payload normalization.
- Implement `health` and `capture_creator` commands.
- Add pinned Python dependencies and a PyInstaller one-directory build script.
- Build locally and verify the packaged executable on the known creator card.

## Task 5: Wire automatic fallback into production capture

- Add failing TypeScript tests proving successful primary capture never downloads, eligible failure installs/runs fallback once, risk-control does not loop, and double failure preserves actionable fallbacks.
- Wire the fallback collector into `production-runtime.ts` without changing existing downstream processing.
- Add concise progress/error notifications.

## Task 6: Publish and verify the downloadable component

- Add a GitHub workflow that builds, tests, packages and publishes the engine ZIP plus manifest.
- Publish a real component release and verify URL/hash.
- Test from a clean component directory with no Python dependency.

## Task 7: Release candidate verification

- Run full tests, typecheck, build, diff check and audit.
- Build an unpublished Windows installer.
- Install/test the candidate against a clean user-data directory and the known creator card.
- Only then bump/release the desktop app.

