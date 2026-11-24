# Cortex

A calm, local-first RSS reader for macOS (Tauri + React + Rust + SQLite).

## Repository layout

- `app/` — Tauri application (React + TypeScript frontend, Rust backend)
- `docs/` — project docs and workflow notes
- `prompts/` — reusable prompt snippets
- `logs/` — lightweight project logs

## What it does

Cortex is built around one daily loop: follow a curated set of feeds, skim what's new, read comfortably, keep what matters.

- **Subscriptions** — paste a site or feed URL (the feed is discovered), organize feeds into categories (drag to move / reorder), OPML import & export.
- **Daily triage** — all feeds sync concurrently on launch and on an interval; unread-first list; per-feed and per-category unread counts; mark scope as read. Articles are kept for 30 days.
- **Read later** — a lightweight queue (`L`) separate from favorites; never expires.
- **Feed health** — a subscription manager shows which feeds are failing, slowing down or have gone quiet.
- **Reader** — full-text extraction for teaser feeds, one sanitized and consistent format, table of contents, adjustable font size, focus mode, reading position restore.
- **Bilingual reading** — on demand (`T`), paragraph-by-paragraph translation through your own Ollama server, shown under each paragraph (original / bilingual / translation-only), cached locally. For single words, select and press ⌃⌘D to use the macOS dictionary.
- **Local archive** — favoriting an article stores its full text with images inlined in the local database. Favorites survive deleting the feed or the original page going away, and can be exported as Markdown (with images) for Obsidian and similar tools.
- **AI summary** — one short summary on demand, using the same Ollama model.

## Keyboard

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `j` / `k` | next / previous article | `t` | toggle bilingual |
| `f` | favorite + archive | `⇧T` | translation only |
| `l` | read later | `+` / `-` | font size |
| `r` | toggle read | `s` | AI summary |
| `o` | open original in browser | `space` | page down |
| `/` | search | `\` | focus mode |
| `⇧A` | mark list as read | `⌘R` / `⌘N` / `⌘,` | sync / add feed / settings |

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

### Ollama (translation & summary)

Configure the Ollama address and model in Settings → 翻译与摘要 (default `http://localhost:11434`). If Ollama runs on another machine, it must listen on a reachable interface (`OLLAMA_HOST=0.0.0.0`).

### Data

Everything lives in `~/Library/Application Support/com.zhenliangzhang.cortex/cortex.db` (SQLite). Back up that one file to keep subscriptions, favorites/archives and translation cache.

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
