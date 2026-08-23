# Repository completeness and reproducibility

A releasable commit is a complete public software definition: a clean checkout plus tracked lockfiles, manifests, scripts, and documented public resources must be enough to build and verify the Windows application. An old worktree, installed app, cache, generated artifact, local model, personal path, token, or cross-repository copy is never a fallback.

## Resource origins

Every packaged input is one of the following:

| Input | Origin and verification |
|---|---|
| Application source and brand assets | Tracked Git files. |
| Scrapling engine | generated public Scrapling from tracked source, locked Python dependencies, and the selected commit; its generated manifest and provenance are verified before packaging. |
| Speech model | fetched from an immutable Hugging Face revision recorded with byte counts and SHA-256 in the tracked model manifest. |
| FFmpeg | fetched through the tracked ffmpeg manifest, including immutable release tag, byte counts, SHA-256, and license data. |
| Node, Electron, and native modules | `npm ci` from the tracked lockfile and toolchain contract. |

Generation or fetching fails on a missing manifest, changed revision, unexpected origin, size mismatch, checksum mismatch, or checkout escape. The package resource verifier confirms every `extraResources` input belongs to this contract.

## Exact-commit acceptance

An exact commit becomes acceptable only when evidence outside the checkout records a successful Node test/typecheck gate, resource verification, Electron package verification, offline and startup smoke checks, build manifest, and SHA-256 checksums for that same full SHA. A source checkout alone is not acceptance evidence.

The release gate also runs a disjoint public candidate scan, Gitleaks, and reviewed visual JSON verification. Evidence must be generated from the selected commit rather than copied from another directory or repository.

## Prohibited inputs

Do not add credentials, App Secrets, API keys, tokens, cookies, user data, generated ZIPs, models, installers, logs, or binaries to Git. Do not depend on an authenticated download, an untracked preparer, an old manifest, a machine cache, or another repository. Public resources must be recorded by the commit and verified by immutable version/revision and SHA-256.
