# Contributing to Offcourse

## Local setup

Offcourse requires Node.js 22+, pnpm through Corepack, ffmpeg, and a Chromium browser for Playwright.

```bash
corepack enable
pnpm install
pnpm exec playwright install chromium
pnpm check
```

Use `pnpm test` while developing. Run `pnpm test:integration` when changing network or ffmpeg behavior; these tests may require external tools or network access.

## Commits and hooks

Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/), for example:

```text
fix(scraper): preserve signed playlist parameters
test(storage): cover atomic file replacement
docs: add session troubleshooting
```

The Husky hooks enforce the repository checks:

- `pre-commit` runs lint-staged formatting.
- `commit-msg` validates the Conventional Commit message.
- `pre-push` runs `pnpm check` (format, lint, types, unit tests, and build).

Keep pull requests focused, add regression coverage for behavior changes, and describe any integration checks that cannot run in CI.
