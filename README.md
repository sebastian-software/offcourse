# course-grab

CLI tool to download online courses for offline access. Saves video content and lesson text as Markdown files, organized by module structure.

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
git clone https://github.com/your-username/course-grab.git
cd course-grab

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
course-grab login

# Force re-login
course-grab login --force
```

### Sync a Course

```bash
# Download entire course
course-grab sync https://www.skool.com/your-community/classroom

# Skip video downloads
course-grab sync <url> --skip-videos

# Skip text content
course-grab sync <url> --skip-content

# Preview without downloading
course-grab sync <url> --dry-run

# Limit to first N lessons (for testing)
course-grab sync <url> --limit 5
```

### Configuration

```bash
# Show current config
course-grab config show

# Set output directory
course-grab config set outputDir ~/Courses

# Set video quality (highest, lowest, 1080p, 720p, 480p)
course-grab config set videoQuality 720p

# Set download concurrency (1-5)
course-grab config set concurrency 3

# Run headless (no browser window)
course-grab config set headless true
```

### Inspect (Debugging)

```bash
# Analyze page structure
course-grab inspect <url>

# Save analysis to files
course-grab inspect <url> --output ./analysis

# Include full HTML dump
course-grab inspect <url> --full
```

## Output Structure

```
~/Downloads/course-grab/
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

