# Architecture

## Overview

Offcourse is a modular CLI tool for downloading online courses. The architecture is designed to support multiple learning platforms through a plugin-like pattern.

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI Layer                           │
│  (commands: login, sync, logout, complete, status, etc.)   │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│     Scraper     │  │   Downloader    │  │     Storage     │
│  (per platform) │  │ (per video host)│  │   (file system) │
└─────────────────┘  └─────────────────┘  └─────────────────┘
          │                   │                   │
          └───────────────────┼───────────────────┘
                              ▼
                    ┌─────────────────┐
                    │     Config      │
                    │  (Zod schemas)  │
                    └─────────────────┘
```

## Directory Structure

```
src/
├── cli/                         # Command-line interface
│   ├── index.ts                 # Commander entry point and command registration
│   ├── syncPlatform.ts          # Auto-detection for supported platform URLs
│   ├── syncPipeline.ts          # Shared extraction and video-download lifecycle
│   └── commands/
│       ├── config.ts            # Configuration management
│       ├── inspect.ts           # Page analysis for debugging
│       ├── login.ts             # Authentication flow
│       ├── status.ts            # Skool sync-state reporting
│       ├── sync.ts              # Skool download orchestration
│       ├── syncHighLevel.ts     # HighLevel download orchestration
│       ├── syncJoshComeau.ts    # Josh Comeau download orchestration
│       ├── syncLearningSuite.ts # LearningSuite download orchestration
│       └── syncPiccalilli.ts    # Piccalilli download orchestration
│
├── config/                      # Configuration management
│   ├── schema.ts                # Zod schemas for all config types
│   ├── configManager.ts         # Load/save configuration
│   └── paths.ts                 # Path resolution utilities
│
├── scraper/                     # Platform-specific extraction
│   ├── waits.ts                 # Shared best-effort content waits
│   ├── extractor.ts             # Skool lesson content extraction
│   ├── navigator.ts             # Skool course discovery
│   ├── schemas.ts               # Shared scraper response schemas
│   ├── skoolAuth.ts             # Skool login detection and session verification
│   ├── videoInterceptor.ts      # Network interception for video URLs
│   ├── highlevel/
│   │   ├── extractor.ts
│   │   ├── navigator.ts
│   │   ├── schemas.ts
│   │   └── index.ts
│   ├── joshcomeau/
│   │   ├── auth.ts
│   │   ├── extractor.ts
│   │   ├── navigator.ts
│   │   └── index.ts
│   ├── learningsuite/
│   │   ├── auth.ts
│   │   ├── extractor.ts
│   │   ├── navigator.ts
│   │   └── index.ts
│   └── piccalilli/
│       ├── auth.ts
│       ├── extractor.ts
│       ├── navigator.ts
│       └── index.ts
│
├── downloader/                  # Video download handlers
│   ├── index.ts                 # Download dispatcher by video type
│   ├── hlsDownloader.ts         # Generic/HighLevel HLS downloads
│   ├── hlsValidator.ts          # HLS validation
│   ├── loomDownloader.ts        # Loom-specific downloads
│   ├── vimeoDownloader.ts       # Vimeo-specific downloads
│   └── shared/
│       ├── ffmpeg.ts
│       ├── hlsDownload.ts
│       ├── network.ts
│       ├── progressiveDownload.ts
│       ├── types.ts
│       └── index.ts
│
├── shared/                      # Cross-platform utilities
│   ├── auth.ts                  # Shared Playwright session management
│   ├── firebase.ts              # HighLevel Firebase token helpers
│   ├── fs.ts                    # File-system utilities
│   ├── http.ts                  # HTTP defaults
│   ├── parallelWorker.ts        # Browser-tab worker pools
│   ├── shutdown.ts              # Signal and resource cleanup
│   ├── slug.ts                  # Slug generation
│   ├── url.ts                   # URL normalization
│   ├── videoDetection.ts        # Shared video-host detection
│   └── index.ts
│
├── state/
│   ├── courseState.ts           # Cross-platform course-state initialization
│   ├── database.ts              # SQLite-backed course sync state
│   └── index.ts
│
└── storage/
    └── fileSystem.ts            # Course directory and file operations
```

## Key Components

### CLI Layer (`src/cli/`)

Handles user interaction via Commander.js. Each command is a separate module.

- **login**: Opens browser for interactive authentication, saves session
- **sync**: Auto-detects platform and delegates to appropriate handler
- **sync handlers**: Platform-specific orchestration selected internally by URL
- **syncPipeline.ts**: Shared extraction and video-download stages with progress and interruption handling
- **inspect**: Debug tool for analyzing page structure
- **config**: Read/write configuration values

### Scraper (`src/scraper/`)

Platform-specific logic for extracting course content.

#### Skool Scraper (root level)

- **skoolAuth.ts**: Detects login pages and verifies saved Skool sessions
- **src/shared/auth.ts**: Manages Playwright browser sessions and persistence
- **navigator.ts**: Discovers course structure (modules, lessons, URLs)
- **extractor.ts**: Extracts video URLs and text content from lesson pages
- **videoInterceptor.ts**: Intercepts network requests to capture video URLs

#### HighLevel Scraper (`src/scraper/highlevel/`)

- **src/shared/auth.ts** and **src/shared/firebase.ts**: Firebase session and token handling
- **navigator.ts**: Extracts course structure via API interception
- **extractor.ts**: Extracts HLS video URLs, embedded videos (Vimeo, Loom), and content

#### LearningSuite Scraper (`src/scraper/learningsuite/`)

- **navigator.ts**: Course structure extraction via GraphQL API
- **extractor.ts**: Video/content extraction (HLS, Vimeo, Loom, native)
- **schemas.ts**: Zod schemas for GraphQL responses

#### Josh Comeau Scraper (`src/scraper/joshcomeau/`)

- **auth.ts**: Magic Link authentication and course-access verification
- **navigator.ts**: Course curriculum and lesson discovery
- **extractor.ts**: Lesson Markdown, resources, and Vimeo HLS extraction

#### Piccalilli Scraper (`src/scraper/piccalilli/`)

- **auth.ts**: Email/OTP authentication with reusable browser sessions
- **navigator.ts**: Course and lesson discovery from the course navigation
- **extractor.ts**: Lesson content, resources, and video extraction

To add a new platform, create a new directory under `src/scraper/` with the same interfaces.

### Downloader (`src/downloader/`)

Video download handlers. Each video host needs its own implementation.

- **index.ts**: Dispatches each video task to the appropriate host-specific downloader
- **loomDownloader.ts**: Handles Loom's HLS streaming format
- **vimeoDownloader.ts**: Handles Vimeo video downloads
- **hlsDownloader.ts**: Generic HLS download using ffmpeg (used for HighLevel native videos)
- **index.ts**: Dispatcher that routes downloads by video type

### State (`src/state/`)

Persistent, platform-scoped course state management using SQLite.

- **database.ts**: Manages modules, lessons, download metadata, and failure details
- **courseState.ts**: Builds stable keys and reconciles course structures for every supported platform
- Enables resume functionality for interrupted syncs

### Storage (`src/storage/`)

File system abstraction for saving content.

- Creates directory structure mirroring course hierarchy
- Saves markdown content and video files
- Tracks sync state to enable resume

### Config (`src/config/`)

Centralized configuration with Zod validation.

- **schema.ts**: Type-safe schemas for all configuration
- **configManager.ts**: Persists config to `~/.offcourse/`
- **paths.ts**: Path resolution utilities

## Data Flow

```
1. User runs: offcourse sync <url>
                    │
2. Auto-detect      │
   platform ────────────► Skool? Josh Comeau? LearningSuite? Piccalilli? HighLevel?
                    │
3. Load config      │
                    ▼
4. Authenticate ─────────► Browser session (cached or interactive)
                    │
5. Navigate ────────────► Extract course structure (parallel browser tabs)
                    │
6. Extract content ────► Parallel workers extract lessons simultaneously
   ├─► Get video URL + text content
   ├─► Write Markdown to disk
   └─► Queue video for download
                    │
7. Process downloads ───► Download videos with concurrency control
                    │
8. Done ────────────────► Summary output
```

### Parallel Processing

The `parallelWorker` module provides a shared worker pool for parallel operations:

- **Worker Pool**: Multiple browser tabs share the same authenticated session
- **Task Queue**: Tasks are distributed across workers automatically
- **Progress Tracking**: Real-time aggregated progress across all workers
- **Error Isolation**: Failed tasks don't crash other workers

Used by course scanning and content extraction. The shared video-download stage implements its own concurrency and interruption handling in `syncPipeline.ts`.

## Platform-Specific Details

### Skool

- **Auth**: Standard session-based, browser login
- **Structure**: DOM-based extraction via Playwright selectors
- **Videos**: Loom, Vimeo, native video elements

### HighLevel (GoHighLevel)

- **Auth**: Firebase authentication via `sso.clientclub.net`
- **Structure**: API-based extraction (`services.leadconnectorhq.com`)
- **Videos**: Native HLS streams, Vimeo, Loom embeds
- **Special**: Requires ffmpeg for native video downloads

### LearningSuite

- **Auth**: Custom session-based, browser login
- **Structure**: GraphQL API (`api.learningsuite.io/{tenantId}/graphql`)
- **Videos**: HLS streams, Vimeo, Loom, native video elements
- **URL Pattern**: `{subdomain}.learningsuite.io/student/course/{courseId}`
- **Tenant ID**: Extracted from subdomain or API responses

### Josh Comeau Courses

- **Auth**: Email Magic Link with persisted Playwright storage state
- **Structure**: DOM-based curriculum and lesson discovery
- **Content**: Markdown, linked resources, and Vimeo HLS videos
- **URL Pattern**: `courses.joshwcomeau.com/<course>`

### Piccalilli

- **Auth**: Email/OTP login with persisted Playwright storage state
- **Structure**: DOM-based course and lesson discovery
- **Content**: Markdown, linked resources, and embedded videos
- **URL Pattern**: `piccalil.li/<course>/lessons`

## Adding a New Platform

1. **Create scraper directory**: `src/scraper/<platform>/`
2. **Implement modules**:
   - `auth.ts` - Authentication flow
   - `navigator.ts` - Course structure extraction
   - `extractor.ts` - Content/video extraction
   - `index.ts` - Exports
3. **Create sync handler**: `src/cli/commands/sync<Platform>.ts`
4. **Register in CLI**: Add delegation to `src/cli/index.ts`
5. **Add auto-detection**: Update `sync` command's platform detection

## Adding a New Video Host

1. **Create downloader**: Implement in `src/downloader/<host>Downloader.ts`
2. **Export from index**: Add to `src/downloader/index.ts` dispatcher
3. **Update extractor**: Add detection in platform-specific `extractVideoUrl()`

## Technology Choices

| Purpose            | Technology     | Rationale                                    |
| ------------------ | -------------- | -------------------------------------------- |
| Browser automation | Playwright     | Reliable, handles SPAs, session persistence  |
| CLI framework      | Commander.js   | Standard, declarative command definition     |
| Validation         | Zod            | Runtime validation with TypeScript inference |
| HTML → Markdown    | Turndown       | Mature, configurable                         |
| Styling            | Chalk + Ora    | Clean terminal output with spinners          |
| Database           | better-sqlite3 | Fast, embedded SQLite for state management   |
| HLS downloads      | ffmpeg         | Industry standard for HLS stream processing  |

## Development Tooling

| Tool        | Purpose                   | Configuration            |
| ----------- | ------------------------- | ------------------------ |
| TypeScript  | Type safety               | `tsconfig.json`          |
| ESLint      | Linting                   | `eslint.config.js`       |
| Prettier    | Code formatting           | `.prettierrc` (defaults) |
| Vitest      | Testing                   | `vitest.config.ts`       |
| Husky       | Git hooks                 | `.husky/`                |
| lint-staged | Pre-commit formatting     | `package.json`           |
| commitlint  | Commit message validation | `commitlint.config.js`   |
| release-it  | Release management        | `.release-it.json`       |

### Git Hooks

- **pre-commit**: Formats staged files with Prettier via lint-staged
- **pre-push**: Runs the full `pnpm check` gate
- **commit-msg**: Validates conventional commit format

### Release Process

Releases use [release-it](https://github.com/release-it/release-it) with the conventional changelog plugin:

1. Validates code (lint, typecheck, test)
2. Determines version bump from commit history
3. Updates `CHANGELOG.md` with categorized changes
4. Creates Git tag and GitHub release
5. Publishes to npm
