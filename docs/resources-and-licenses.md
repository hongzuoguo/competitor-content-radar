# Resources and licenses

This document records how a public HitMuse release identifies its third-party
inputs. It deliberately names only licenses that are verified by tracked
manifests or installed package metadata; an absent license claim is not an
assertion that the component has no license.

## Dependency records

- `package-lock.json` is the npm dependency and Electron/native-module lock.
  It contains resolved package URLs and npm SRI integrity entries, and `npm ci`
  verifies those values.
- The Python hash lock for the generated Scrapling engine lives with the
  tracked engine source. Its Python environment must be recreated from that
  lock rather than copied from a workstation.
- Electron and native modules are obtained through the npm lock and rebuilt
  for the release Electron ABI. They include `better-sqlite3`, `nodejieba`, and
  `sherpa-onnx-node`; their package metadata is the authority for their license
  declarations.

## Generated Scrapling engine

`engine/scrapling` is tracked source used to generate the immutable engine ZIP.
It is not a runtime fallback. Each accepted release carries
`engine-manifest.json` and `engine-provenance.json`, which bind the archive to
its source revision, build inputs, byte count, and SHA-256. Redistribution must
retain those provenance records and comply with the licenses declared by the
tracked source dependencies.

The locked engine dependency is `scrapling[fetchers] 0.4.11`, upstream tag
`v0.4.11`: <https://github.com/D4Vinci/Scrapling/tree/v0.4.11>. Scrapling is an
independent project licensed under BSD-3-Clause, Copyright (c) 2024 Karim
shoair. Its complete license notice is reproduced in
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) and is carried in every
verified HitMuse release. HitMuse's MIT license applies only to HitMuse-owned
code and does not relicense Scrapling.

## SenseVoice

`resources/model-manifest.json` pins SenseVoice to revision
`2365baeacb507f821a0c8120fcee3d484dba7a07` and identifies the model license as
`LicenseRef-FunASR`. The exact license artifact is
<https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/LICENSE>.
For upstream project context, see
<https://github.com/FunAudioLLM/SenseVoice/blob/main/LICENSE>.

## FFmpeg

The installed `ffmpeg-static 5.3.0` metadata selects binary release `b6.1.1`
and declares `GPL-3.0-or-later`. A distributor must provide the applicable GPL
notice and fulfill the relevant FFmpeg source-offer requirements for the
distributed binary. Upstream project and legal materials are available at
<https://github.com/eugeneware/ffmpeg-static> and <https://ffmpeg.org/legal.html>.

## Public release obligations

The release inventory includes `THIRD_PARTY_NOTICES.md`, public user guides,
the engine manifests, installer metadata, and deterministic checksums. These
records support source and redistribution obligations: keep the notices and
license references with redistributed releases, preserve required copyright and
license texts, and make any source or offer required by an applicable upstream
license available to recipients. Do not replace a pinned resource, npm lock, or
provenance record with an unrecorded local copy.
