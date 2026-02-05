-- Migration 002: Disable FTS triggers to avoid SQL logic errors

DROP TRIGGER IF EXISTS articles_fts_insert;
DROP TRIGGER IF EXISTS articles_fts_delete;
DROP TRIGGER IF EXISTS articles_fts_update;

INSERT OR IGNORE INTO schema_migrations (version) VALUES (2);
