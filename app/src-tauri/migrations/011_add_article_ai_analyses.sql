CREATE TABLE IF NOT EXISTS article_ai_analyses (
    id TEXT PRIMARY KEY,
    article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    mode TEXT NOT NULL,
    summary TEXT,
    score INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_article_ai_analyses_article_id_created_at
    ON article_ai_analyses(article_id, created_at DESC);
