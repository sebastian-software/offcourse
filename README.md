# Offcourse

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

| Platform | URL Pattern |
|----------|-------------|
| [Skool](https://skool.com) | `skool.com/community/classroom` |
| [HighLevel](https://gohighlevel.com) | `member.*.com/courses/...` |
| [LearningSuite](https://learningsuite.io) | `*.learningsuite.io/student/...` |

## Key Commands

```bash
# Sync a course (auto-detects platform)
offcourse sync <url>

# Sync with options
offcourse sync <url> --skip-videos      # Text only
offcourse sync <url> --dry-run          # Preview
offcourse sync <url> --limit 5          # Test with 5 lessons

# Unlock sequential content (LearningSuite)
offcourse complete <url>

# Configuration
offcourse config set outputDir ~/Courses
offcourse config set videoQuality 720p
```

## Development

```bash
git clone https://github.com/sebastian-software/offcourse.git
cd offcourse
npm install
npm run build
npm link  # optional: link globally
```

### Commands

```bash
npm run dev        # Watch mode
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm test           # Tests
npm run release    # Release to npm
```

### Adding a New Platform

1. Create `src/scraper/newplatform/` with:
   - `auth.ts` – Session detection
   - `navigator.ts` – Course structure
   - `extractor.ts` – Content extraction
   - `schemas.ts` – Zod schemas
2. Add CLI command in `src/cli/commands/`
3. Register in `src/cli/index.ts`

## Acknowledgments

Thanks to [Sindre Sorhus](https://github.com/sindresorhus) for the excellent packages powering this project: `slugify`, `conf`, `delay`, `execa`, `ky`, `p-queue`, `p-retry`.

## License

MIT
