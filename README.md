# Offcourse

[![npm version](https://img.shields.io/npm/v/offcourse?color=cb0000&label=npm)](https://www.npmjs.com/package/offcourse)
[![npm downloads](https://img.shields.io/npm/dm/offcourse?color=cb0000)](https://www.npmjs.com/package/offcourse)
[![license](https://img.shields.io/npm/l/offcourse?color=cb0000)](https://github.com/sebastian-software/offcourse/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/offcourse?color=cb0000)](https://nodejs.org)
[![codecov](https://codecov.io/gh/sebastian-software/offcourse/graph/badge.svg)](https://codecov.io/gh/sebastian-software/offcourse)
[![CI](https://github.com/sebastian-software/offcourse/actions/workflows/ci.yml/badge.svg)](https://github.com/sebastian-software/offcourse/actions/workflows/ci.yml)

Download online courses for offline access – of course! 📚

Saves video content and lesson text as Markdown files, organized by module structure.

## Features

- 🔐 **Browser-based authentication** – Log in once, sessions are cached
- 📚 **Course structure preservation** – Maintains module/lesson hierarchy
- 🎬 **Video downloads** – Supports Loom, native video (Vimeo, YouTube, Wistia planned)
- 📝 **Content extraction** – Converts lesson text to clean Markdown
- ⏸️ **Resumable syncs** – Skips already downloaded content
- ⚡ **Concurrent downloads** – Configurable parallelism

## Supported Platforms

| Platform | Status |
|----------|--------|
| [Skool.com](https://skool.com) | ✅ Supported |
| [LearningSuite.io](https://learningsuite.io) | 🚧 Planned |

## Installation

```bash
# Clone the repository
git clone https://github.com/sebastian-software/offcourse.git
cd offcourse

# Install dependencies
npm install

# Build
npm run build

# Link globally (optional)
npm link
```

Requires Node.js 22+.

## Usage

### Login

```bash
# Opens browser for interactive login
offcourse login

# Force re-login
offcourse login --force
```

### Sync a Course

```bash
# Download entire course
offcourse sync https://www.skool.com/your-community/classroom

# Skip video downloads
offcourse sync <url> --skip-videos

# Skip text content
offcourse sync <url> --skip-content

# Preview without downloading
offcourse sync <url> --dry-run

# Limit to first N lessons (for testing)
offcourse sync <url> --limit 5
```

### Configuration

```bash
# Show current config
offcourse config show

# Set output directory
offcourse config set outputDir ~/Courses

# Set video quality (highest, lowest, 1080p, 720p, 480p)
offcourse config set videoQuality 720p

# Set download concurrency (1-5)
offcourse config set concurrency 3

# Run headless (no browser window)
offcourse config set headless true
```

### Inspect (Debugging)

```bash
# Analyze page structure
offcourse inspect <url>

# Save analysis to files
offcourse inspect <url> --output ./analysis

# Include full HTML dump
offcourse inspect <url> --full
```

## Output Structure

```
~/Downloads/offcourse/
└── course-name/
    ├── 01-module-name/
    │   ├── 01-lesson-name/
    │   │   ├── content.md
    │   │   └── video.mp4
    │   └── 02-another-lesson/
    │       ├── content.md
    │       └── video.mp4
    └── 02-next-module/
        └── ...
```

## Development

```bash
# Watch mode
npm run dev

# Run directly (without build)
npx tsx src/cli/index.ts <command>

# Lint
npm run lint

# Format
npm run format

# Type check
npm run typecheck

# Test
npm test
```

## License

MIT
