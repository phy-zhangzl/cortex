# Cortex

Cortex is a lightweight Tauri-based RSS reader for macOS with article extraction and AI-assisted reading workflows.

## Repository layout

- `app/` — Tauri application (React + TypeScript frontend, Rust backend)
- `docs/` — project docs and workflow notes
- `prompts/` — reusable prompt snippets
- `logs/` — lightweight project logs

## Core capabilities

- RSS / Atom subscription management
- Category-based feed organization
- Feed synchronization and article storage
- Full-text article extraction
- AI-assisted article analysis
- Import / export of subscriptions

## Development quick start

### Requirements

- Node.js 20+
- npm 10+
- Rust stable
- Xcode Command Line Tools (for macOS builds)

### Run locally

```bash
cd app
npm ci
npm run tauri:dev
```

### Validate before commit

```bash
cd app
npm run check
```

### Build release

```bash
cd app
npm run tauri:build
```

## Release process

See:

- `CONTRIBUTING.md`
- `RELEASE.md`
- `CHANGELOG.md`

Automation included:

- CI validation on pushes and pull requests
- Automatic macOS release build on Git tags like `v0.1.2`
- Dependabot updates for npm, Cargo, and GitHub Actions

## Branch strategy

- `main` — release-ready branch
- `feature/*` — feature work
- `fix/*` — bug fixes
- `chore/*` — maintenance

## Versioning

This project uses semantic versioning:

- `patch` for bug fixes
- `minor` for backward-compatible features
- `major` for breaking changes

Tags follow the format:

- `v0.1.1`
- `v0.2.0`

## License

MIT — see `LICENSE`.
