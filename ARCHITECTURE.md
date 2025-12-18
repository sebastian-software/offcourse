# Architecture

## Overview

Offcourse is a modular CLI tool for downloading online courses. The architecture is designed to support multiple learning platforms through a plugin-like pattern.

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI Layer                           │
│  (commands: login, sync, inspect, config)                   │
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
├── cli/                    # Command-line interface
│   ├── index.ts            # Entry point, command registration
│   └── commands/
│       ├── config.ts       # Configuration management
│       ├── inspect.ts      # Page analysis for debugging
│       ├── login.ts        # Authentication flow
│       └── sync.ts         # Main download orchestration
│
├── config/                 # Configuration management
│   ├── schema.ts           # Zod schemas for all config types
│   ├── configManager.ts    # Load/save configuration
│   └── paths.ts            # Path resolution utilities
│
├── scraper/                # Platform-specific extraction
│   ├── auth.ts             # Session management (Playwright)
│   ├── navigator.ts        # Course structure discovery
│   └── extractor.ts        # Content extraction (video URLs, text)
│
├── downloader/             # Video download handlers
│   ├── index.ts            # Download dispatcher by video type
│   ├── queue.ts            # Async queue with concurrency control
│   └── loomDownloader.ts   # Loom-specific HLS download
│
└── storage/                # File system operations
    └── fileSystem.ts       # Directory creation, file saving
```

## Key Components

### CLI Layer (`src/cli/`)

Handles user interaction via Commander.js. Each command is a separate module.

- **login**: Opens browser for interactive authentication, saves session
- **sync**: Orchestrates the full download process
- **inspect**: Debug tool for analyzing page structure
- **config**: Read/write configuration values

### Scraper (`src/scraper/`)

Platform-specific logic for extracting course content. Currently supports Skool.com.

- **auth.ts**: Manages Playwright browser sessions, session persistence
- **navigator.ts**: Discovers course structure (modules, lessons, URLs)
- **extractor.ts**: Extracts video URLs and text content from lesson pages

To add a new platform, implement the same interfaces with platform-specific selectors.

### Downloader (`src/downloader/`)

Video download handlers. Each video host (Loom, Vimeo, etc.) needs its own implementation.

- **queue.ts**: Generic async queue with concurrency control and retry logic
- **loomDownloader.ts**: Handles Loom's HLS streaming format
- **index.ts**: Dispatcher that routes downloads by video type

### Storage (`src/storage/`)

File system abstraction for saving content.

- Creates directory structure mirroring course hierarchy
- Saves markdown content and video files
- Tracks sync state to enable resume

### Config (`src/config/`)

Centralized configuration with Zod validation.

- **schema.ts**: Type-safe schemas for all configuration
- **configManager.ts**: Persists config to `~/.offcourse/`

## Data Flow

```
1. User runs: offcourse sync <url>
                    │
2. Load config      │
                    ▼
3. Authenticate ─────────► Browser session (cached or interactive)
                    │
4. Navigate ────────────► Extract course structure (modules, lessons)
                    │
5. For each lesson: │
   ├─► Extract ─────────► Get video URL + text content
   ├─► Save content ────► Write Markdown to disk
   └─► Queue video ─────► Add to download queue
                    │
6. Process queue ───────► Download videos with concurrency control
                    │
7. Done ────────────────► Summary output
```

## Adding a New Platform

1. **Create scraper**: Implement `navigator.ts` and `extractor.ts` equivalents
2. **Register in CLI**: Add platform detection in `sync.ts`
3. **Reuse infrastructure**: Use existing `downloader/`, `storage/`, `config/`

## Adding a New Video Host

1. **Create downloader**: Implement in `src/downloader/<host>Downloader.ts`
2. **Export from index**: Add to `src/downloader/index.ts` dispatcher
3. **Update extractor**: Add detection in `extractVideoUrl()`

## Technology Choices

| Purpose | Technology | Rationale |
|---------|------------|-----------|
| Browser automation | Playwright | Reliable, handles SPAs, session persistence |
| CLI framework | Commander.js | Standard, declarative command definition |
| Validation | Zod | Runtime validation with TypeScript inference |
| HTML → Markdown | Turndown | Mature, configurable |
| Styling | Chalk + Ora | Clean terminal output with spinners |
