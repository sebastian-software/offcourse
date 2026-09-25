# Offcourse

[![Powered by Sebastian Software](https://img.shields.io/badge/Powered%20by-Sebastian%20Software-00718d?style=flat-square)](https://oss.sebastian-software.com)
[![npm version](https://img.shields.io/npm/v/offcourse?color=3b82f6&label=npm)](https://www.npmjs.com/package/offcourse)
[![npm downloads](https://img.shields.io/npm/dm/offcourse?color=3b82f6)](https://www.npmjs.com/package/offcourse)
[![license](https://img.shields.io/npm/l/offcourse?color=3b82f6)](https://github.com/sebastian-software/offcourse/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-3b82f6)](https://nodejs.org)
[![codecov](https://codecov.io/gh/sebastian-software/offcourse/graph/badge.svg)](https://codecov.io/gh/sebastian-software/offcourse)
[![CI](https://github.com/sebastian-software/offcourse/actions/workflows/ci.yml/badge.svg)](https://github.com/sebastian-software/offcourse/actions/workflows/ci.yml)

Download online courses for offline access – of course! 📚

**[→ View Documentation & Homepage](https://sebastian-software.github.io/offcourse/)**

## Quick Start

```bash
# Install
npm install -g offcourse

# Download a course
offcourse sync <course-url>

# Or run without installing
npx offcourse sync <course-url>
```

Requires Node.js 22+ and [ffmpeg](https://ffmpeg.org/) for HLS videos.
Video transcription is enabled by default and requires the native
[Cuttledoc CLI](https://github.com/sebastian-software/cuttledoc) on `PATH`. Use `--no-transcribe` to download without transcription.

## Supported Platforms

| Platform                                               | URL Pattern                        |
| ------------------------------------------------------ | ---------------------------------- |
| [Skool](https://skool.com)                             | `skool.com/community/classroom`    |
| [HighLevel](https://gohighlevel.com)                   | `member.*.com/courses/...`         |
| [Josh Comeau Courses](https://courses.joshwcomeau.com) | `courses.joshwcomeau.com/<course>` |
| [LearningSuite](https://learningsuite.io)              | `*.learningsuite.io/student/...`   |
| [Piccalilli](https://piccalil.li)                      | `piccalil.li/<course>/lessons`     |

## Key Commands

```bash
# Sync a course (auto-detects platform)
offcourse sync <url>

# Sync with options
offcourse sync <url> --skip-videos      # Skip downloading videos
offcourse sync <url> --dry-run          # Preview
offcourse sync <url> --limit 5          # Test with 5 lessons
offcourse sync <url>                    # Download, then transcribe with Cuttledoc
offcourse sync <url> --no-transcribe    # Download without transcription

# Skool login with community access verification
offcourse login https://www.skool.com/<community>/classroom

# Piccalilli OTP login (sync also prompts automatically)
offcourse login https://piccalil.li/<course>/lessons

# Josh Comeau Magic Link login (sync also prompts automatically)
offcourse login https://courses.joshwcomeau.com/<course>

# LearningSuite login (session is saved per tenant)
offcourse login https://<tenant>.learningsuite.io/student/course/<course>/<id>

# Recheck cached LearningSuite lessons for additional videos and provided subtitles
offcourse sync <url> --refresh-media

# Unlock sequential content (LearningSuite)
offcourse complete <url>

# Configuration (optional)
offcourse config set outputDir ~/Courses  # Default: current directory
offcourse config set videoQuality 720p    # Default: highest
offcourse config set concurrency 3        # Parallel downloads (1-5, default: 2)
offcourse config set extractionConcurrency 6  # Browser tabs (1-8, default: 4)
offcourse config set cuttledocPath /usr/local/bin/cuttledoc
offcourse config set transcriptionLanguage de
offcourse config set transcriptionBackend auto
offcourse config set transcriptionEnhancement local
```

## Transcription

Offcourse integrates Cuttledoc through its native CLI instead of embedding a platform-specific
Node module. This keeps course extraction independent from speech engines and lets both tools be
installed and released separately.

```bash
# Verify the native dependency
cuttledoc --version

# Transcribe new downloads and retry unfinished jobs from earlier runs
offcourse sync <course-url>

# Override the configured language, backend, or enhancement for one run
offcourse sync <course-url> \
  --transcription-language en \
  --transcription-backend auto \
  --transcription-enhancement off
```

Transcription runs automatically after downloads and is sequential to keep model memory bounded.
Use `--no-transcribe` to disable it for a sync; `--dry-run` never transcribes.
`--skip-videos` only skips downloads: existing local videos can still be transcribed. For every video,
Offcourse writes `<video-stem>.transcript.json` with Cuttledoc's complete machine-readable result
and `<video-stem>.transcript.md` for reading. SQLite stores the Cuttledoc version, selected settings,
durations, attempts, and errors.

Repeat the same `offcourse sync <course-url>` command to fill in missing transcripts for existing
downloads. Downloaded videos are reused. Complete transcript files are skipped, even when there
is no transcription record in SQLite. Missing Markdown is restored from valid JSON without
running Cuttledoc. Missing or invalid JSON triggers transcription while preserving any existing
nonempty Markdown, including manual edits. The files are checked even when SQLite marks the
transcription as completed.

Each sync attempts every unfinished video once and continues after individual transcription
failures. A subsequent sync retries missing transcripts regardless of previous attempt counts.
`sync --force` explicitly regenerates transcripts as well as refreshing course content.

If Apple Speech rejects a zero-duration word at the end of a clip, Offcourse retries once
using a temporary audio copy with two seconds of trailing silence. Original videos stay intact;
the transcript JSON records this preprocessing and excludes the padding from the media duration.

LearningSuite lessons can contain multiple videos. Offcourse saves the first video under the
lesson filename and additional videos with a stable `.video-<id>.mp4` suffix. Available platform
subtitles are also saved as `.captions.json`, `.captions.md`, and WebVTT files. Use
`--refresh-media` once to discover additional media in lessons downloaded by older versions;
existing videos are reused.

## Performance

Course scanning and content extraction use `extractionConcurrency` browser tabs (default: 4). All tabs share the same authenticated session. Video downloads use a separate `concurrency` queue (default: 2), so browser work and network/download load can be tuned independently.

## Troubleshooting

### ffmpeg is missing

Video downloads that use HLS require ffmpeg. Confirm it is available with `ffmpeg -version`; if the command is missing, install ffmpeg with your operating system's package manager and retry the sync.

### Cuttledoc is missing

Transcription is the only feature that requires Cuttledoc. It requires the native v3 CLI; the
older v1/v2 npm releases are not compatible. Follow the native CLI setup instructions in the
[Cuttledoc repository](https://github.com/sebastian-software/cuttledoc), verify it with
`cuttledoc --version`, or configure an explicit executable:

```bash
offcourse config set cuttledocPath /absolute/path/to/cuttledoc
```

If Cuttledoc is missing, downloaded videos remain on disk. Use `sync --no-transcribe` to
continue downloading, then repeat `sync <course-url>` after setting up Cuttledoc to fill in
missing transcripts.
Local recognition currently requires Apple Silicon with macOS 26+, FFmpeg, and the selected
backend’s speech assets or model. The default backend selection stays local; no hosted backend
is enabled automatically.

### Playwright cannot find Chromium

Install the browser binary used by the scraper, then retry:

```bash
npx playwright install chromium
```

When working from a repository checkout, use `pnpm exec playwright install chromium` instead.

### A saved session expired

Clear the saved session and force a fresh login for the affected platform URL:

```bash
offcourse logout <url>
offcourse login <url> --force
```

### A lesson failed

Offcourse stores per-lesson failure details for every supported platform and supports a targeted
retry:

```bash
offcourse status <url> --errors
offcourse sync <url> --retry-failed
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions, Git hooks, and pull-request expectations.

```bash
git clone https://github.com/sebastian-software/offcourse.git
cd offcourse
corepack enable
pnpm install
pnpm build
pnpm link --global  # optional: link globally
```

### Commands

```bash
pnpm dev               # Watch mode
pnpm check             # Format, lint, types, unit tests, and build
pnpm test              # Unit tests in watch mode
pnpm test:integration  # Network/ffmpeg integration tests
```

### Releases

Releases are automated with [Release Please](https://github.com/googleapis/release-please). Merging its release PR updates the package version and changelog, creates the GitHub release, and publishes the package to npm. The recommended setup is [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) for the `publish.yml` workflow; an `NPM_TOKEN` repository secret remains supported as a fallback. A `RELEASE_PLEASE_TOKEN` secret is recommended so release PRs run the regular pull-request CI. To recover a release after configuring npm authentication, run the `Release` workflow manually with `publish` set to `true`.

### Adding a New Platform

1. Create `src/scraper/newplatform/` with:
   - `auth.ts` – Session detection
   - `navigator.ts` – Course structure
   - `extractor.ts` – Content extraction
   - `schemas.ts` – Zod schemas
2. Add a platform sync handler in `src/cli/commands/`
3. Register URL detection in `src/cli/syncPlatform.ts` and delegation in `src/cli/index.ts`

## Acknowledgments

Thanks to [Sindre Sorhus](https://github.com/sindresorhus) for the excellent packages powering this project: `slugify`, `conf`, `delay`, `execa`, `ky`, `p-retry`.

## License

MIT

---

<!-- sebastian-software-branding:start -->
<p align="center">
  <a href="https://oss.sebastian-software.com">
    <img src="https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg" alt="Sebastian Software" width="240" />
  </a>
</p>

<p align="center">
  <a href="https://oss.sebastian-software.com">Open Source at Sebastian Software</a><br />
  Copyright &copy; 2026 Sebastian Software GmbH
</p>
<!-- sebastian-software-branding:end -->
