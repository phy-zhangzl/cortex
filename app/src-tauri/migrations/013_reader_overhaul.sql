-- Migration 013: reader overhaul
--
-- 1. Articles no longer disappear with their feed: favorites survive feed deletion
--    (feed_id becomes NULL, feed_title keeps the source name) and can carry a
--    self-contained local archive (archived_html, images inlined).
-- 2. (feed_id, url) is unique so sync can use INSERT OR IGNORE.
-- 3. Multi-mode AI analysis is retired; only a single summary remains.
-- 4. Paragraph translation cache.
-- 5. Web API sources are retired; feeds are plain RSS/Atom.

DROP TABLE IF EXISTS article_ai_analyses;

CREATE TABLE articles_new (
    id TEXT PRIMARY KEY,
    feed_id TEXT REFERENCES feeds(id) ON DELETE SET NULL,
    feed_title TEXT,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    author TEXT,
    pub_date DATETIME,
    summary TEXT,
    content TEXT,
    content_extracted BOOLEAN NOT NULL DEFAULT 0,
    archived_html TEXT,
    archived_at DATETIME,
    ai_summary TEXT,
    ai_updated_at DATETIME,
    is_read BOOLEAN NOT NULL DEFAULT 0,
    is_favorite BOOLEAN NOT NULL DEFAULT 0,
    read_progress REAL NOT NULL DEFAULT 0,
    fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_articles_feed_url ON articles_new(feed_id, url);

INSERT OR IGNORE INTO articles_new (
    id, feed_id, feed_title, title, url, author, pub_date, summary, content,
    content_extracted, ai_summary, ai_updated_at, is_read, is_favorite,
    read_progress, fetched_at, created_at, updated_at
)
SELECT
    a.id, a.feed_id, f.title, a.title, a.url, a.author, a.pub_date, a.summary, a.content,
    COALESCE(a.content_extracted, 0), a.ai_summary, a.ai_updated_at,
    COALESCE(a.is_read, 0), COALESCE(a.is_favorite, 0), COALESCE(a.read_progress, 0),
    COALESCE(a.fetched_at, CURRENT_TIMESTAMP), COALESCE(a.created_at, CURRENT_TIMESTAMP),
    COALESCE(a.updated_at, CURRENT_TIMESTAMP)
FROM articles a
LEFT JOIN feeds f ON f.id = a.feed_id
ORDER BY a.created_at;

DROP TABLE articles;
ALTER TABLE articles_new RENAME TO articles;

CREATE INDEX idx_articles_pub_date ON articles(pub_date DESC);
CREATE INDEX idx_articles_unread ON articles(feed_id, is_read);
CREATE INDEX idx_articles_favorite ON articles(is_favorite);

CREATE TABLE IF NOT EXISTS translations (
    key TEXT PRIMARY KEY,
    target_lang TEXT NOT NULL,
    source TEXT NOT NULL,
    translated TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE feeds DROP COLUMN source_type;
ALTER TABLE feeds DROP COLUMN source_config;

-- Old multi-provider AI settings (including plaintext API keys) are no longer used.
DELETE FROM settings WHERE key LIKE 'ai\_%' ESCAPE '\';
