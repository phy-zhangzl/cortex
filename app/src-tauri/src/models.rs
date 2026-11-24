use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Feed {
    pub id: String,
    pub title: String,
    pub url: String,
    pub site_url: Option<String>,
    pub category_id: Option<String>,
    pub last_fetch_at: Option<DateTime<Utc>>,
    pub last_fetch_error: Option<String>,
    pub unread_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct FeedHealth {
    pub id: String,
    pub title: String,
    pub url: String,
    pub site_url: Option<String>,
    pub category_id: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub last_fetch_at: Option<DateTime<Utc>>,
    pub last_fetch_error: Option<String>,
    pub fetch_error_count: i64,
    pub latest_entry_at: Option<DateTime<Utc>>,
    pub recent_count: i64,
    pub unread_count: i64,
    pub favorite_count: i64,
}

pub const FEED_SELECT: &str = "SELECT f.id, f.title, f.url, f.site_url, f.category_id, f.last_fetch_at, f.last_fetch_error, \
    (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id AND a.is_read = 0) AS unread_count \
    FROM feeds f";

/// Lightweight row for list views (no body).
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ArticleListItem {
    pub id: String,
    pub feed_id: Option<String>,
    pub feed_title: Option<String>,
    pub title: String,
    pub url: String,
    pub author: Option<String>,
    pub pub_date: Option<DateTime<Utc>>,
    pub excerpt: Option<String>,
    pub is_read: bool,
    pub is_favorite: bool,
    pub read_later: bool,
    pub is_archived: bool,
}

pub const ARTICLE_LIST_SELECT: &str = "SELECT a.id, a.feed_id, COALESCE(f.title, a.feed_title) AS feed_title, \
    a.title, a.url, a.author, a.pub_date, substr(a.summary, 1, 600) AS excerpt, a.is_read, a.is_favorite, a.read_later, \
    (a.archived_html IS NOT NULL) AS is_archived \
    FROM articles a LEFT JOIN feeds f ON f.id = a.feed_id";

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Article {
    pub id: String,
    pub feed_id: Option<String>,
    pub feed_title: Option<String>,
    pub title: String,
    pub url: String,
    pub author: Option<String>,
    pub pub_date: Option<DateTime<Utc>>,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub content_extracted: bool,
    pub archived_html: Option<String>,
    pub archived_at: Option<DateTime<Utc>>,
    pub ai_summary: Option<String>,
    pub is_read: bool,
    pub is_favorite: bool,
    pub read_later: bool,
    pub read_progress: f64,
}

pub const ARTICLE_SELECT: &str = "SELECT a.id, a.feed_id, COALESCE(f.title, a.feed_title) AS feed_title, \
    a.title, a.url, a.author, a.pub_date, a.summary, a.content, a.content_extracted, a.archived_html, a.archived_at, \
    a.ai_summary, a.is_read, a.is_favorite, a.read_later, a.read_progress \
    FROM articles a LEFT JOIN feeds f ON f.id = a.feed_id";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncFailure {
    pub feed_id: String,
    pub title: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncReport {
    pub finished_at: DateTime<Utc>,
    pub feeds: usize,
    pub new_articles: i64,
    pub failures: Vec<SyncFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredFeed {
    pub url: String,
    pub title: String,
    pub site_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub base_url: String,
    pub model: String,
    pub target_lang: String,
}
