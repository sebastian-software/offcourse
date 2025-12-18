#!/usr/bin/env node

const VERSION = "0.0.2";

const banner = `
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ┌─┐┌─┐┌─┐┌─┐┌─┐┬ ┬┬─┐┌─┐┌─┐                                ║
║   │ │├┤ ├┤ │  │ ││ │├┬┘└─┐├┤                                 ║
║   └─┘└  └  └─┘└─┘└─┘┴└─└─┘└─┘                                ║
║                                                               ║
║   Download online courses for offline access – of course! 📚  ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`;

const comingSoon = `
🚧 Coming Soon!

This package is currently in private development.
The full release will include:

  • 🔐 Browser-based authentication with session caching
  • 📚 Course structure preservation (module/lesson hierarchy)
  • 🎬 Video downloads (Loom, Vimeo, YouTube, Wistia)
  • 📝 Content extraction to clean Markdown
  • ⏸️ Resumable syncs
  • ⚡ Concurrent downloads

Supported platforms:
  • Skool.com (ready)
  • LearningSuite.io (planned)

Follow the project:
  → https://github.com/sebastian-software/offcourse

`;

console.log(banner);
console.log(comingSoon);

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(`v${VERSION}`);
}

