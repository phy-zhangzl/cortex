use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Feed {
    pub id: String,
    pub title: String,
    pub url: String,
    pub site_url: Option<String>,
    pub description: Option<String>,
    pub category_id: Option<String>,
    pub favicon_url: Option<String>,
    pub last_fetch_at: Option<DateTime<Utc>>,
    pub last_fetch_error: Option<String>,
    pub fetch_error_count: i32,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Article {
    pub id: String,
    pub feed_id: String,
    pub title: String,
    pub url: String,
    pub author: Option<String>,
    pub pub_date: Option<DateTime<Utc>>,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub content_extracted: bool,
    pub is_read: bool,
    pub is_favorite: bool,
    pub read_progress: f64,
    pub fetched_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ArticleView {
    pub id: String,
    pub feed_id: String,
    pub feed_title: String,
    pub title: String,
    pub url: String,
    pub author: Option<String>,
    pub pub_date: String,
    pub summary: String,
    pub content: Option<String>,
    pub is_read: bool,
    pub is_favorite: bool,
}
