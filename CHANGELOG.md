# Changelog

All notable changes to this project will be documented in this file.

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
