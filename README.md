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
offcourse sync <url> --skip-videos      # Text only
offcourse sync <url> --dry-run          # Preview
offcourse sync <url> --limit 5          # Test with 5 lessons

# Skool login with community access verification
offcourse login https://www.skool.com/<community>/classroom

# Piccalilli OTP login (sync also prompts automatically)
offcourse login https://piccalil.li/<course>/lessons

# Josh Comeau Magic Link login (sync also prompts automatically)
offcourse login https://courses.joshwcomeau.com/<course>

# LearningSuite login (session is saved per tenant)
offcourse login https://<tenant>.learningsuite.io/student/course/<course>/<id>

# Unlock sequential content (LearningSuite)
offcourse complete <url>

# Configuration (optional)
offcourse config set outputDir ~/Courses  # Default: current directory
offcourse config set videoQuality 720p    # Default: highest
offcourse config set concurrency 3        # Parallel downloads (1-5, default: 2)
offcourse config set extractionConcurrency 6  # Browser tabs (1-8, default: 4)
```

## Performance

Course scanning and content extraction use `extractionConcurrency` browser tabs (default: 4). All tabs share the same authenticated session. Video downloads use a separate `concurrency` queue (default: 2), so browser work and network/download load can be tuned independently.

## Troubleshooting

### ffmpeg is missing

Video downloads that use HLS require ffmpeg. Confirm it is available with `ffmpeg -version`; if the command is missing, install ffmpeg with your operating system's package manager and retry the sync.

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
pnpm release           # Release to npm
```

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
