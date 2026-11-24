-- Migration 014: read-later queue and feed health tracking

ALTER TABLE articles ADD COLUMN read_later BOOLEAN NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_articles_read_later ON articles(read_later);

-- Date of the newest entry the feed itself published (independent of local retention).
ALTER TABLE feeds ADD COLUMN latest_entry_at DATETIME;
UPDATE feeds SET latest_entry_at = (SELECT MAX(pub_date) FROM articles a WHERE a.feed_id = feeds.id);
