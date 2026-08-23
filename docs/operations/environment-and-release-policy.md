# Development, preview, and release environment policy

HitMuse has exactly three isolated environments. They must never share `node_modules`, native ABI outputs, generated resources, user data, or release artifacts.

## 1. Node Dev

The canonical source workspace is a long-lived Node-ABI checkout at `<repo-root>`. Use it for ordinary development, `npm ci`, tests, type checking, and the isolated Scrapling setup in [CONTRIBUTING.md](../../CONTRIBUTING.md). Do not package an installer or switch its dependencies to Electron ABI.

## 2. Persistent Electron Preview

Preview is a separately configured long-lived Electron-ABI worktree with its own dependencies and isolated user-data directory. It supports fast visual and desktop checks only. It is not a reproducibility proof, installer source, resource fallback, or formal acceptance input. Its portable ownership, fingerprint, reinstall, and PID rules are in [`electron-preview.md`](./electron-preview.md).

## 3. Disposable formal release / clean acceptance

`npm run release:local` creates a disposable Electron-ABI worktree from one exact committed SHA, installs dependencies once, obtains only tracked public resource inputs, packages with `--publish never`, verifies the output, records evidence outside the checkout, and removes only release-owned temporary paths. It does not publish a tag, GitHub Release, or installer.

The Node test commit, packaging worktree commit, build manifest, checksums, and accepted installer must identify the same full SHA. A clean Git status is required before the formal workflow begins.

## Required release gates

Before packaging, run the Node tests and typecheck, then verify generated and fetched resources against their tracked integrity information. Before publication, the workflow requires the public candidate verifier, Gitleaks, package/offline/smoke checks, checksums, and reviewed visual JSON bound to the exact commit. No token, non-public resource, cross-repository artifact, or manually copied output is a valid fallback.
