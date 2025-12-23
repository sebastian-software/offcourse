# Offcourse

[![npm version](https://img.shields.io/npm/v/offcourse?color=3b82f6&label=npm)](https://www.npmjs.com/package/offcourse)
[![npm downloads](https://img.shields.io/npm/dm/offcourse?color=3b82f6)](https://www.npmjs.com/package/offcourse)
[![license](https://img.shields.io/npm/l/offcourse?color=3b82f6)](https://github.com/sebastian-software/offcourse/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-3b82f6)](https://nodejs.org)
[![codecov](https://codecov.io/gh/sebastian-software/offcourse/graph/badge.svg)](https://codecov.io/gh/sebastian-software/offcourse)
[![CI](https://github.com/sebastian-software/offcourse/actions/workflows/ci.yml/badge.svg)](https://github.com/sebastian-software/offcourse/actions/workflows/ci.yml)

Download online courses for offline access – of course! 📚

Saves video content and lesson text as Markdown files, organized by module structure.

## Features

- 🔐 **Browser-based authentication** – Log in once, sessions are cached
- 📚 **Course structure preservation** – Maintains module/lesson hierarchy
- 🎬 **Video downloads** – HLS, Vimeo, Loom, native MP4/WebM
- 📎 **Attachments** – Downloads PDFs and other course materials
- 📝 **Content extraction** – Converts lesson text to clean Markdown
- ⏸️ **Resumable syncs** – Skips already downloaded content
- ⚡ **Concurrent downloads** – Configurable parallelism
- 🔍 **Auto-detection** – Automatically detects platform from URL

## Supported Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| [Skool.com](https://skool.com) | ✅ Supported | Community courses |
| [HighLevel (GoHighLevel)](https://gohighlevel.com) | ✅ Supported | Membership portals, ClientClub |
| [LearningSuite.io](https://learningsuite.io) | ✅ Supported | German LMS platform |

## Installation

```bash
npm install -g offcourse
```

Or run directly with npx:

```bash
npx offcourse <command>
```

Requires Node.js 22+.

For HLS video downloads (HighLevel native videos), [ffmpeg](https://ffmpeg.org/) must be installed:

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg

# Windows (via Chocolatey)
choco install ffmpeg
```

## Usage

### Login

```bash
# Opens browser for interactive login
offcourse login

# Force re-login
offcourse login --force
```

### Sync a Course

The `sync` command auto-detects the platform from the URL:

```bash
# Auto-detect platform and download
offcourse sync <url>

# Skip video downloads
offcourse sync <url> --skip-videos

# Skip text content
offcourse sync <url> --skip-content

# Preview without downloading
offcourse sync <url> --dry-run

# Limit to first N lessons (for testing)
offcourse sync <url> --limit 5

# Override course name (useful when auto-detection fails)
offcourse sync <url> --course-name "My Course Name"

# Prefer specific video quality
offcourse sync <url> --quality 720p
```

### Platform-Specific Commands

```bash
# Skool courses
offcourse sync-skool https://www.skool.com/your-community/classroom

# HighLevel/GoHighLevel membership portals
offcourse sync-highlevel https://member.example.com/courses/products/<id>
offcourse sync-highlevel <url> --course-name "Course Name"

# LearningSuite courses
offcourse sync-learningsuite https://subdomain.learningsuite.io/student/course/<id>
```

### Complete Command (LearningSuite)

Some platforms lock lessons sequentially – you must complete lesson 1 before accessing lesson 2. The `complete` command automatically marks all accessible lessons as complete to unlock more content:

```bash
# Mark all lessons as complete (iterates until no new content unlocks)
offcourse complete <url>

# Show browser window
offcourse complete <url> --visible
```

The command runs in rounds:
1. Scans course structure
2. Starts any unstarted modules
3. Marks accessible lessons as complete
4. Re-scans for newly unlocked content
5. Repeats until nothing changes

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

## Video Providers

Offcourse supports downloading videos from various providers, regardless of which platform hosts the course:

| Provider | Status | Notes |
|----------|--------|-------|
| **HLS Streams** | ✅ Supported | Requires ffmpeg. Used by HighLevel, LearningSuite (via Bunny CDN) |
| **Vimeo** | ✅ Supported | Embedded players, extracts best quality |
| **Loom** | ✅ Supported | Share links and embeds |
| **Native MP4/WebM** | ✅ Supported | Direct file downloads |
| **YouTube** | 🚧 Planned | Requires yt-dlp |
| **Wistia** | 🚧 Planned | Requires special handling |

### CDN Support

Videos are often served through CDNs for better performance:

- **Bunny CDN** – Used by LearningSuite for HLS streams (requires session cookies)
- **Cloudflare Stream** – Common for HighLevel native videos
- **Vimeo CDN** – For embedded Vimeo players

## Platform Notes

### HighLevel (GoHighLevel)

HighLevel is an all-in-one marketing platform with a "Memberships" feature for hosting courses.

| Feature | Support |
|---------|---------|
| Authentication | Firebase-based login via browser |
| Course structure | API-based extraction (products, categories, posts) |
| Videos | Native HLS with quality selection, Vimeo, Loom embeds |
| Attachments | ✅ Supported |

**URL patterns:**
- `https://member.yourdomain.com/courses/...`
- `https://portal.yourdomain.com/courses/...`
- `https://courses.yourdomain.com/...`

### LearningSuite

LearningSuite is a German LMS platform popular with coaches and course creators.

| Feature | Support |
|---------|---------|
| Authentication | Browser-based with session caching |
| Course structure | DOM-based extraction |
| Videos | HLS streams via Bunny CDN (requires ffmpeg + cookies) |
| Attachments | ✅ PDFs and course materials |
| Sequential unlocking | Use `offcourse complete <url>` |

**URL format:** `https://{subdomain}.learningsuite.io/student/course/{slug}/{courseId}`

**Note:** Videos require session cookies which are automatically extracted from the browser session.

## Architecture

```
src/
├── cli/              # Command-line interface
│   ├── commands/     # Individual commands (sync, login, config, etc.)
│   └── index.ts      # CLI entry point
├── config/           # Configuration management
├── downloader/       # Video download handlers
│   ├── hlsDownloader.ts    # HLS/m3u8 streams (ffmpeg)
│   ├── vimeoDownloader.ts  # Vimeo video extraction
│   ├── loomDownloader.ts   # Loom video extraction
│   └── queue.ts            # Download queue with concurrency
├── scraper/          # Platform-specific scrapers
│   ├── highlevel/    # HighLevel/GoHighLevel support
│   ├── learningsuite/# LearningSuite support
│   ├── extractor.ts  # Common content extraction
│   └── navigator.ts  # Common navigation utilities
├── shared/           # Shared utilities
│   ├── auth.ts       # Authentication helpers
│   ├── url.ts        # URL parsing utilities
│   └── slug.ts       # Filename sanitization
├── state/            # SQLite database for tracking
└── storage/          # File system operations
```

### Adding a New Platform

1. Create a new directory under `src/scraper/` (e.g., `src/scraper/newplatform/`)
2. Implement required modules:
   - `auth.ts` – Session detection and validation
   - `navigator.ts` – Course structure extraction
   - `extractor.ts` – Lesson content extraction
   - `schemas.ts` – Zod schemas for API responses
3. Add CLI command in `src/cli/commands/`
4. Register in `src/cli/index.ts`

## Development

### Setup

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

### Commands

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

### Git Hooks

This project uses [Husky](https://typicode.github.io/husky/) for Git hooks:

- **pre-commit**: Runs Prettier on staged files via lint-staged
- **pre-push**: Runs ESLint and TypeScript type checking
- **commit-msg**: Validates commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)

### Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/). Commit messages must follow this format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, semicolons, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `ci`: CI/CD changes

**Examples:**

```bash
git commit -m "feat: add support for Vimeo downloads"
git commit -m "fix: handle missing video URLs gracefully"
git commit -m "docs: update installation instructions"
```

### Releasing

Releases are managed with [release-it](https://github.com/release-it/release-it). The release process:

1. Runs linting, type checking, and tests
2. Bumps version based on conventional commits
3. Generates/updates `CHANGELOG.md`
4. Creates a Git tag and GitHub release
5. Publishes to npm

```bash
# Interactive release (will prompt for version bump)
npm run release

# Dry run (preview what would happen)
npm run release -- --dry-run

# Specific version bump
npm run release -- --minor
npm run release -- --major
```

## Acknowledgments

A huge thank you to [Sindre Sorhus](https://github.com/sindresorhus) 🙏 for creating and maintaining so many excellent packages that power this project:

- [`@sindresorhus/slugify`](https://github.com/sindresorhus/slugify) – Slugify a string
- [`conf`](https://github.com/sindresorhus/conf) – Simple config handling
- [`delay`](https://github.com/sindresorhus/delay) – Delay a promise
- [`execa`](https://github.com/sindresorhus/execa) – Process execution for humans
- [`ky`](https://github.com/sindresorhus/ky) – Tiny & elegant HTTP client
- [`p-queue`](https://github.com/sindresorhus/p-queue) – Promise queue with concurrency control
- [`p-retry`](https://github.com/sindresorhus/p-retry) – Retry a promise-returning function

His commitment to high-quality, well-documented, and beautifully designed open source software is truly inspiring. If you find his work useful, consider [sponsoring him](https://github.com/sponsors/sindresorhus).

## License

MIT
