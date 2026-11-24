# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-11-24

A reset around the core loop: subscribe to good sources, skim what's new every day, read comfortably, keep what matters.

### Added
- Bilingual reading on demand: paragraph-by-paragraph translation via a self-hosted Ollama server, shown under each paragraph (original / bilingual / translation-only, `t` / `⇧T`). Translations are cached locally.
- Local archive for favorites: starring an article saves its full text with images inlined into the local database, so it survives the feed or the web page disappearing.
- Favorites survive feed deletion (they are detached and keep the source name).
- Category management: create, rename, reorder (drag), delete; drag feeds between categories; unread counts per feed and category.
- Feed discovery: paste a site's homepage and the RSS/Atom address is found automatically.
- OPML import/export (old JSON backups can still be imported).
- Concurrent sync of all feeds, on launch and on a configurable interval; mark-all-read per scope; reading position restore.
- Single-mode AI summary (`s`) using the same Ollama model.
- Read-later queue (`l`), kept forever like favorites.
- Feed health manager: active / slow / dormant / failing feeds at a glance.
- Export favorites (or a single article) as Markdown with images.
- 30-day article retention (favorites and read-later are kept).
- Redesigned UI: consistent icon buttons with shortcut tooltips, segmented controls, popovers, typography options (size, serif/sans, line width), refined light and dark themes.

### Changed
- Frontend split from a single 2,800-line component into sidebar / list / reader / dialogs with one store.
- All article HTML now goes through an allowlist sanitizer and layout normalizer (previously only WeChat content was cleaned).
- Article lists load without bodies and page from SQLite; feeds dedupe articles with a unique index.
- SQLite connections enable foreign keys on every pooled connection, WAL mode and a busy timeout.

### Removed
- Multi-perspective AI analysis (research / critical / industry / X), analysis history, and the Grok/DeepSeek provider layer, including `.env` configuration. Old AI settings and stored API keys are deleted by migration 013.
- Web API sources (Tencent News author pages, Tencent Cloud columns). Existing feeds of that type remain but will show a sync error; use an RSS bridge such as RSSHub instead.

## [0.2.1] - 2026-03-20

### Fixed
- Fixed residual flicker when switching between saved AI analysis perspectives in the article reader and DMG release build.

## [0.2.0] - 2026-03-20

### Added
- Introduced a unified AI provider layer with support for switching between DeepSeek and Grok-compatible local endpoints.
- Added multi-angle article analysis modes: quick summary, research, critical, industry, and X perspective.
- Added persistent AI analysis history per article, including provider, model, mode, score, and notes.
- Added an AI model configuration modal that shows the currently active provider and model.
- Added a system theme mode alongside explicit light and dark modes.

### Changed
- Improved feed reading behavior by loading more articles by default and fetching feed-scoped article history when a specific subscription is selected.
- Updated the article reader to better support switching between saved AI analyses by mode/provider/model.
- Forced non-streaming AI responses for OpenAI-compatible providers to improve compatibility with local Grok2API deployments.

### Fixed
- Fixed multi-angle analysis selection so switching modes can display the corresponding saved interpretation instead of always falling back to the quick summary.

## [0.1.1] - 2026-03-13

### Fixed
- Replaced `ureq` with `reqwest` for full-text article extraction to avoid proxy-related connection timeouts.
- Restored reliable content fetching for sites such as `mitchellh.com` while keeping RSS sync behavior unchanged.

### Docs
- Added repository-level engineering docs for contribution, release, and versioning workflow.
- Added CI workflow, automated tag-based release workflow, Dependabot, and repository metadata to support a more structured GitHub development process.

## [0.1.0] - 2026-03-13

### Added
- Initial Tauri-based RSS reader implementation.
- Feed management, article sync, article reading, and AI-assisted analysis.
