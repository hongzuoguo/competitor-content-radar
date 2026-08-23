# HitMuse operations documentation

These public documents define reproducible development, preview, local verification, and same-repository release work. They use logical roots such as `<repo-root>` and `<external-build-root>` so no personal workstation path becomes a project requirement.

## Document map

- [`environment-and-release-policy.md`](./environment-and-release-policy.md): the three ABI-isolated environments and release contract.
- [`electron-preview.md`](./electron-preview.md): portable Persistent Electron Preview initialization, ownership, reuse, and release boundary.
- [`repository-completeness.md`](./repository-completeness.md): public generated/fetched resource origins, immutable integrity data, and acceptance evidence.
- [`build-and-clean-test.md`](./build-and-clean-test.md): local `npm run release:local` verification and the Tag-triggered Release workflow.

## Task routing

| Task | Read |
|---|---|
| Ordinary source work | [CONTRIBUTING.md](../../CONTRIBUTING.md) |
| Resource or native-runtime change | environment policy and repository completeness |
| Interactive Electron Preview | environment policy and `electron-preview.md` |
| Formal local installer verification | all three documents above |
| Tag release | all three documents above, then the reviewed visual-evidence gate |

The public candidate verifier and Gitleaks run before a release build. Generated artifacts, user data, credentials, tokens, and cross-repository inputs are not accepted as release inputs.

A development checkout may contain verifier-excluded internal or local records; they are not release inputs. Only a candidate that passes public candidate and privacy gates is publishable.
