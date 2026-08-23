# Formal local verification and Tag release

Use this workflow only from a clean, committed source revision. It verifies one exact commit; it does not replace ordinary development or the persistent Electron Preview workflow.

## Local formal verification

Choose external roots outside every checkout and worktree:

```powershell
$buildCommit = git rev-parse HEAD
$buildRoot = '<external-build-root>'
$testRoot = '<external-test-root>'
$releaseRoot = '<external-release-root>'
npm run release:local -- -Commit $buildCommit -BuildRoot $buildRoot -TestRoot $testRoot -ReleaseRoot $releaseRoot -NoLaunch
```

`npm run release:local` runs the required Node gates before creating a disposable Electron worktree, packages the installer with `--publish never`, verifies generated public Scrapling, immutable model and ffmpeg manifest inputs, runs packaged checks, and writes manifests/checksums outside the checkout. It does not publish a tag, GitHub Release, or installer.

The command must not accept a token, a non-public resource, an old generated engine, a local model cache, an existing release directory, or artifacts from another repository. On failure it records the exact failed stage and retains only paths whose ownership cannot be proved safely.

## Tag release

After review, create a Tag named `v<package.version>` at the exact verified commit. Pushing that Tag starts the same-repository GitHub Actions workflow.

The workflow first validates that the Tag and event SHA match `package.json`, runs Node validation, public candidate and Gitleaks gates, generates and verifies the public Scrapling transport artifact, prepares immutable resources, builds the installer and user guide, performs offline and smoke checks, and creates SHA-256 evidence. It requires the repository variable containing reviewed visual JSON to bind to the exact commit before publication. Only after those gates pass does the workflow publisher create the GitHub Release in the same repository.

Do not use `gh`, a personal access token, a second repository, or a manual asset upload for this process. The workflow uses its scoped repository token only inside the final publisher job.
