-- Migration 001: Initial schema
-- Creates categories, feeds, and articles tables

-- Categories table (supports nested folders)
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES categories(id),
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Feeds table
CREATE TABLE IF NOT EXISTS feeds (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    site_url TEXT,
    description TEXT,
    category_id TEXT REFERENCES categories(id),
    favicon_url TEXT,
    last_fetch_at DATETIME,
    last_fetch_error TEXT,
    fetch_error_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Articles table
CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    author TEXT,
    pub_date DATETIME,
    summary TEXT,
    content TEXT,
    content_extracted BOOLEAN DEFAULT 0,
    is_read BOOLEAN DEFAULT 0,
    is_favorite BOOLEAN DEFAULT 0,
    read_progress REAL DEFAULT 0,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_articles_feed_id ON articles(feed_id);
CREATE INDEX IF NOT EXISTS idx_articles_pub_date ON articles(pub_date DESC);
CREATE INDEX IF NOT EXISTS idx_articles_is_read ON articles(is_read);
CREATE INDEX IF NOT EXISTS idx_articles_is_favorite ON articles(is_favorite);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
    title,
    content,
    content_rowid=rowid
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS articles_fts_insert AFTER INSERT ON articles BEGIN
    INSERT INTO articles_fts(rowid, title, content)
    VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS articles_fts_delete AFTER DELETE ON articles BEGIN
    INSERT INTO articles_fts(articles_fts, rowid, title, content)
    VALUES ('delete', old.rowid, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS articles_fts_update AFTER UPDATE ON articles BEGIN
    INSERT INTO articles_fts(articles_fts, rowid, title, content)
    VALUES ('delete', old.rowid, old.title, old.content);
    INSERT INTO articles_fts(rowid, title, content)
    VALUES (new.rowid, new.title, new.content);
END;

-- Database version tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
