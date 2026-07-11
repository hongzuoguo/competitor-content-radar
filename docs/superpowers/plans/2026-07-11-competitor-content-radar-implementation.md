# Competitor Content Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable Windows Electron application that monitors Douyin creators, processes videos locally, analyzes transcripts with selectable AI providers, persists results, and prepares Feishu synchronization.

**Architecture:** Electron owns the trusted desktop runtime, scheduling, persistent browser session, filesystem access and native processing. A React renderer communicates through a narrow typed IPC bridge. Domain services are adapter-driven so Douyin discovery, transcription, LLM analysis and Feishu sync can be tested without real credentials; SQLite stores durable workflow state and supports resumable stages.

**Tech Stack:** Electron, electron-vite, React, TypeScript, Vitest, Testing Library, Playwright, better-sqlite3, Zod, Zustand, Lucide React, FFmpeg, sherpa-onnx-node, electron-builder.

---

## File Map

- `src/main/`: Electron lifecycle, tray, window, scheduler, IPC and secure storage.
- `src/core/`: pure domain models, highlight rules, workflow transitions and reports.
- `src/services/`: SQLite repositories and external adapters for Douyin, media, ASR, AI and Feishu.
- `src/preload/`: typed, context-isolated renderer bridge.
- `src/renderer/`: React application shell, pages, components, tokens and state.
- `tests/`: unit, integration and renderer behavior tests.
- `resources/`: packaged FFmpeg metadata and model manifest, not the large model itself.

### Task 1: Project foundation and quality gates

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `vitest.config.ts`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`
- Test: `tests/smoke/project-config.test.ts`

- [ ] Write a failing test that imports the shared app metadata and expects the product name and schema version.
- [ ] Run `npm test -- tests/smoke/project-config.test.ts` and verify the import fails.
- [ ] Add the minimal Electron/Vite/React TypeScript structure, scripts for `dev`, `test`, `typecheck`, `build` and `dist`, and shared app metadata.
- [ ] Install pinned dependencies and run the smoke test, typecheck and Electron production build.
- [ ] Commit with `chore: scaffold desktop application`.

### Task 2: Domain model, highlight rules and workflow state machine

**Files:**
- Create: `src/core/domain.ts`, `src/core/highlight-rules.ts`, `src/core/workflow.ts`
- Test: `tests/core/highlight-rules.test.ts`, `tests/core/workflow.test.ts`

- [ ] Write failing tests for absolute likes >= 10,000, relative index >= 150, AI score >= 80, null median behavior and valid stage transitions.
- [ ] Run the focused tests and confirm all assertions fail for missing implementations.
- [ ] Implement typed domain entities, pure highlight evaluation and the discovered-to-completed state machine.
- [ ] Run focused tests and typecheck; confirm invalid stage skips are rejected.
- [ ] Commit with `feat: add workflow domain model`.

### Task 3: SQLite persistence and migrations

**Files:**
- Create: `src/services/database/migrations.ts`, `database.ts`, `repositories.ts`
- Test: `tests/services/database.test.ts`

- [ ] Write failing repository tests using an in-memory database for creators, works, snapshots, analyses, runs and settings.
- [ ] Verify the tests fail because schema and repositories do not exist.
- [ ] Implement transactional migrations, pre-migration backup for file databases and repository methods with stable IDs and timestamps.
- [ ] Verify CRUD, linked records, restart persistence and migration idempotency.
- [ ] Commit with `feat: add durable sqlite storage`.

### Task 4: Secure settings and multi-provider AI adapters

**Files:**
- Create: `src/services/secrets/secret-store.ts`
- Create: `src/services/ai/provider-types.ts`, `provider-catalog.ts`, `openai-compatible.ts`, `analysis-schema.ts`, `analysis-service.ts`, `prompt.ts`
- Test: `tests/services/analysis-service.test.ts`, `tests/services/provider-catalog.test.ts`

- [ ] Write failing tests for provider presets, custom model IDs, structured analysis parsing, transcript prompt-injection isolation and one retry after invalid JSON.
- [ ] Verify tests fail without provider implementations.
- [ ] Implement provider catalog for DeepSeek, Doubao, Kimi, Qwen and custom OpenAI-compatible endpoints; encrypt credentials through an Electron safeStorage-backed interface.
- [ ] Add the fixed analysis schema, trusted system prompt, untrusted transcript boundary, usage metadata and one repair retry.
- [ ] Run tests and typecheck, then commit with `feat: add configurable ai analysis`.

### Task 5: Resumable processing pipeline

**Files:**
- Create: `src/services/pipeline/job-queue.ts`, `retry-policy.ts`, `pipeline.ts`, `ports.ts`
- Test: `tests/services/pipeline.test.ts`, `tests/services/retry-policy.test.ts`

- [ ] Write failing tests for stage resumption, 1/5/15 minute transient retries, Retry-After, user-action failures and concurrency limits.
- [ ] Confirm the tests fail for missing queue behavior.
- [ ] Implement a persisted job queue with sequential creator scans, two downloads, serial ASR, two AI calls and a single Feishu writer.
- [ ] Verify restart resumes at the failed stage without repeating completed work.
- [ ] Commit with `feat: add resumable processing pipeline`.

### Task 6: Media download, audio extraction and local transcription

**Files:**
- Create: `src/services/media/downloader.ts`, `ffmpeg.ts`, `cleanup.ts`
- Create: `src/services/asr/model-manager.ts`, `sensevoice.ts`
- Create: `resources/model-manifest.json`
- Test: `tests/services/model-manager.test.ts`, `tests/services/media-cleanup.test.ts`

- [ ] Write failing tests for resumable model download, SHA-256 verification, WAV arguments and seven-day media cleanup.
- [ ] Verify failures before implementation.
- [ ] Implement streamed downloads, manifest verification, FFmpeg 16k mono WAV extraction, sherpa-onnx adapter boundary and retention cleanup.
- [ ] Use fixture media to verify audio conversion when FFmpeg is available; keep native engine calls behind injectable ports for CI.
- [ ] Commit with `feat: add local media transcription pipeline`.

### Task 7: Douyin browser session and creator discovery

**Files:**
- Create: `src/services/douyin/session.ts`, `discovery.ts`, `normalizers.ts`
- Test: `tests/services/douyin-normalizers.test.ts`, `tests/services/discovery.test.ts`

- [ ] Write failing tests for creator URL normalization, 30-item baseline capture, rolling 120-hour selection and duplicate work handling.
- [ ] Verify focused test failures.
- [ ] Implement a persistent Electron session, visible QR login window, network-response observation and safe public metadata normalization without CAPTCHA bypass.
- [ ] Add explicit auth-expired and risk-control states that pause the creator job.
- [ ] Run adapter tests and commit with `feat: add douyin creator discovery`.

### Task 8: Feishu Bitable and notification integration

**Files:**
- Create: `src/services/feishu/auth.ts`, `bitable.ts`, `schema.ts`, `notifications.ts`
- Test: `tests/services/feishu-schema.test.ts`, `tests/services/feishu-sync.test.ts`

- [ ] Write failing tests for the four-table schema, idempotent upserts, deleted-field detection and webhook notification payloads.
- [ ] Verify tests fail for missing integration.
- [ ] Implement OAuth token handling, root-folder Base creation, linked table provisioning and a single-writer sync adapter.
- [ ] Verify mocked API retries and permission/schema errors remain actionable.
- [ ] Commit with `feat: add feishu data synchronization`.

### Task 9: Scheduling, reports, tray and IPC bridge

**Files:**
- Create: `src/main/scheduler.ts`, `tray.ts`, `ipc.ts`
- Create: `src/core/reports.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`
- Test: `tests/core/reports.test.ts`, `tests/main/scheduler.test.ts`, `tests/main/ipc-contract.test.ts`

- [ ] Write failing tests for 09:00 daily run, Monday 09:30 weekly run, one launch catch-up and daily/weekly report aggregates.
- [ ] Implement the scheduler, tray actions, typed IPC contract and report aggregation without play-count fabrication.
- [ ] Verify catch-up is emitted only once and renderer APIs expose no raw Node primitives.
- [ ] Commit with `feat: add scheduling reports and desktop bridge`.

### Task 10: Design system and application shell

**Files:**
- Create: `src/renderer/src/styles/tokens.css`, `global.css`
- Create: `src/renderer/src/components/AppShell.tsx`, `Sidebar.tsx`, `Topbar.tsx`, `Button.tsx`, `StatusBadge.tsx`, `EmptyState.tsx`
- Create: `src/renderer/src/App.tsx`, `router.tsx`, `state/app-store.ts`
- Test: `tests/renderer/app-shell.test.tsx`, `tests/renderer/components.test.tsx`

- [ ] Write failing accessibility and navigation tests for the shell and core controls.
- [ ] Implement DESIGN.md tokens, restrained side navigation, keyboard focus states and responsive minimum width behavior.
- [ ] Verify screen-reader names, keyboard navigation, reduced-motion rules and no horizontal clipping at the supported desktop sizes.
- [ ] Commit with `feat: build desktop application shell`.

### Task 11: Overview and Today Highlight inspector

**Files:**
- Create: `src/renderer/src/pages/OverviewPage.tsx`
- Create: `src/renderer/src/features/overview/RunStatus.tsx`, `MetricStrip.tsx`, `HighlightList.tsx`, `HighlightInspector.tsx`, `TaskHealth.tsx`
- Test: `tests/renderer/overview.test.tsx`

- [ ] Write failing tests for loading, empty, populated, partial-failure and inspector-open states.
- [ ] Implement the overview around operational decisions: running status, compact metrics, highlight reasons, content trends and task health.
- [ ] Make a highlight row open the right inspector with reason, tags, metrics, summary, original link and Feishu action.
- [ ] Run renderer tests and visually inspect at 1280x800 and 1600x900.
- [ ] Commit with `feat: add overview decision workspace`.

### Task 12: Creator, works, tasks and settings surfaces

**Files:**
- Create: `src/renderer/src/pages/CreatorsPage.tsx`, `WorksPage.tsx`, `TasksPage.tsx`, `SettingsPage.tsx`
- Create: `src/renderer/src/features/creators/CreatorForm.tsx`, `CreatorTable.tsx`
- Create: `src/renderer/src/features/settings/AiProviderSettings.tsx`, `ConnectionSettings.tsx`, `RuleSettings.tsx`
- Test: `tests/renderer/creators.test.tsx`, `works.test.tsx`, `tasks.test.tsx`, `settings.test.tsx`

- [ ] Write failing tests for adding up to 10 creators, filtering works, retrying from a failed stage, provider selection and 10,000-like rule editing.
- [ ] Implement the four task surfaces with inline validation, progressive disclosure and actionable failures.
- [ ] Keep local transcription hidden during normal setup and expose only model repair status when needed.
- [ ] Run all renderer tests and commit with `feat: add management and settings surfaces`.

### Task 13: First-run onboarding and hardening

**Files:**
- Create: `src/renderer/src/features/onboarding/SetupWizard.tsx`
- Modify: renderer pages and service error mappings
- Test: `tests/renderer/onboarding.test.tsx`, `tests/renderer/error-states.test.tsx`

- [ ] Write failing tests for first-run sequence, skipped optional Feishu notification, expired login, insufficient AI balance, offline and long-content states.
- [ ] Implement the setup wizard for Douyin login, AI provider, Feishu authorization, first creator and schedule confirmation.
- [ ] Add skeleton loading, educational empty states, recovery actions and redacted diagnostic export.
- [ ] Run accessibility and error-state tests; commit with `feat: add onboarding and recovery states`.

### Task 14: Packaging and end-to-end verification

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/app.spec.ts`, `build/entitlements.md`
- Modify: `package.json`, Electron builder configuration, `README.md`

- [ ] Add an end-to-end demo-data test that launches Electron, opens a highlight inspector, switches pages and saves a rule.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build` and `npm run test:e2e` from a clean install.
- [ ] Build the Windows x64 installer and launch the unpacked app for a smoke test.
- [ ] Run an Impeccable critique/audit/polish pass and fix concrete accessibility, hierarchy and responsive findings.
- [ ] Document credential setup, model download, storage paths, privacy boundaries and known Douyin risk-control limitations.
- [ ] Commit with `build: package verified windows desktop app`.

## Self-review

- Spec coverage maps every confirmed requirement to Tasks 2–14, including absolute and relative highlight rules, model choices, retry semantics, retention, Feishu tables, schedules, catch-up, tray, secure storage and all confirmed screens.
- Native dependencies are isolated behind injectable interfaces so unit tests do not require credentials or a downloaded ASR model.
- External services remain honest: real end-to-end calls require user credentials and Douyin login; automated tests use contract fixtures and mocks.
- No automatic AI failover, play-count fabrication, CAPTCHA bypass or separate Python service is introduced.
