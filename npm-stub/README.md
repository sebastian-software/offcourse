# Offcourse

[![npm version](https://img.shields.io/npm/v/offcourse?color=cb0000&label=npm)](https://www.npmjs.com/package/offcourse)
[![npm downloads](https://img.shields.io/npm/dm/offcourse?color=cb0000)](https://www.npmjs.com/package/offcourse)
[![license](https://img.shields.io/npm/l/offcourse?color=cb0000)](https://github.com/sebastian-software/offcourse/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/offcourse?color=cb0000)](https://nodejs.org)

Download online courses for offline access – of course! 📚

> 🚧 **Coming Soon** – This package is currently in private development.

## What is Offcourse?

Offcourse is a CLI tool that downloads online courses for offline access. It preserves the course structure, downloads videos, and converts lesson content to clean Markdown files.

## Planned Features

- 🔐 **Browser-based authentication** – Log in once, sessions are cached
- 📚 **Course structure preservation** – Maintains module/lesson hierarchy
- 🎬 **Video downloads** – Supports Loom, native video (Vimeo, YouTube, Wistia planned)
- 📝 **Content extraction** – Converts lesson text to clean Markdown
- ⏸️ **Resumable syncs** – Skips already downloaded content
- ⚡ **Concurrent downloads** – Configurable parallelism

## Supported Platforms

| Platform | Status |
|----------|--------|
| [Skool.com](https://skool.com) | ✅ Ready |
| [LearningSuite.io](https://learningsuite.io) | 🚧 Planned |

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

## Stay Updated

⭐ Star the repo to get notified when we release:

→ [github.com/sebastian-software/offcourse](https://github.com/sebastian-software/offcourse)

## License

MIT © [Sebastian Software GmbH](https://sebastian-software.de)

