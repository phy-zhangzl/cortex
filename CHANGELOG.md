# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1] - 2026-03-13

### Fixed
- Replaced `ureq` with `reqwest` for full-text article extraction to avoid proxy-related connection timeouts.
- Restored reliable content fetching for sites such as `mitchellh.com` while keeping RSS sync behavior unchanged.

### Docs
- Added repository-level engineering docs for contribution, release, and versioning workflow.
- Added CI workflow and repository metadata to support a more structured GitHub development process.

## [0.1.0] - 2026-03-13

### Added
- Initial Tauri-based RSS reader implementation.
- Feed management, article sync, article reading, and AI-assisted analysis.
