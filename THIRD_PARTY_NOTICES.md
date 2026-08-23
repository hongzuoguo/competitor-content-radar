# Third-party notices

This product is distributed with dependencies and resources whose exact versions
and integrity data are recorded in `package-lock.json` and the tracked resource
manifests. This notice identifies the bundled components that need a direct
redistribution notice; it is not a substitute for the full licenses delivered
by their upstream projects.

## npm and Electron dependencies

The JavaScript, Electron, and native Node-module dependency graph is locked by
`package-lock.json`. `npm ci` verifies the lockfile's resolved URLs and SRI
integrity values. License declarations for individual npm packages are supplied
by the installed package metadata; this project does not assert a license where
that metadata has not been verified.

The packaged desktop application includes Electron and native modules such as
`better-sqlite3`, `nodejieba`, `sherpa-onnx-node`, and `ffmpeg-static`. Their
sources, notices, and license texts remain subject to their respective upstream
terms.

## FFmpeg

`ffmpeg-static 5.3.0` installs the FFmpeg binary release tag `b6.1.1` used by
this application. Its installed package metadata declares `GPL-3.0-or-later`.
Source and license information: <https://github.com/eugeneware/ffmpeg-static>.
The corresponding FFmpeg source and license materials are available from the
FFmpeg project: <https://ffmpeg.org/legal.html>.

## SenseVoice model

The bundled SenseVoice Small model is pinned in
`resources/model-manifest.json` to revision
`2365baeacb507f821a0c8120fcee3d484dba7a07`. That manifest records its license
as `LicenseRef-FunASR` and fixes the upstream license URL:
<https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/LICENSE>.

## Scrapling engine

HitMuse uses `scrapling[fetchers] 0.4.11` from the independent upstream project
<https://github.com/D4Vinci/Scrapling> to generate the packaged Scrapling engine
archive. Upstream tag: `v0.4.11`. Scrapling is licensed under the BSD 3-Clause
License. HitMuse is not affiliated with or endorsed by the Scrapling project or
its copyright holder.

The packaged archive is generated from the tracked `engine/scrapling`
integration source plus the locked upstream dependency and is identified at
release time by its engine manifest and provenance record. The release evidence
includes both `engine-manifest.json` and `engine-provenance.json` so recipients
can identify the exact source and build inputs.

### Scrapling BSD 3-Clause License

BSD 3-Clause License

Copyright (c) 2024, Karim shoair

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

For the full acquisition, integrity, and redistribution record, see
[`docs/resources-and-licenses.md`](docs/resources-and-licenses.md).
