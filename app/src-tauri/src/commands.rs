use crate::models::{Article, Category, Feed};
use crate::services::content_service::ContentService;
use crate::services::feed_service::FeedService;
use chrono::Utc;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

pub struct AppState {
    pub pool: SqlitePool,
}

#[tauri::command]
pub async fn list_categories(state: State<'_, AppState>) -> Result<Vec<Category>, String> {
    let categories = sqlx::query_as::<_, Category>(
        "SELECT id, name, parent_id, sort_order, created_at, updated_at FROM categories ORDER BY sort_order, name",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(categories)
}

#[tauri::command]
pub async fn create_category(
    state: State<'_, AppState>,
    name: String,
    parent_id: Option<String>,
) -> Result<Category, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();

    sqlx::query(
        "INSERT INTO categories (id, name, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(&parent_id)
    .bind(0)
    .bind(now)
    .bind(now)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(Category {
        id,
        name,
        parent_id,
        sort_order: 0,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
pub async fn update_category_name(
    state: State<'_, AppState>,
    category_id: String,
    name: String,
) -> Result<Category, String> {
    let now = Utc::now();
    sqlx::query("UPDATE categories SET name = ?, updated_at = ? WHERE id = ?")
        .bind(&name)
        .bind(now)
        .bind(&category_id)
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    let updated = sqlx::query_as::<_, Category>(
        "SELECT id, name, parent_id, sort_order, created_at, updated_at FROM categories WHERE id = ?",
    )
    .bind(&category_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(updated)
}

#[tauri::command]
pub async fn delete_category(
    state: State<'_, AppState>,
    category_id: String,
) -> Result<(), String> {
    sqlx::query("UPDATE feeds SET category_id = NULL WHERE category_id = ?")
        .bind(&category_id)
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM categories WHERE id = ?")
        .bind(&category_id)
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn list_feeds(state: State<'_, AppState>) -> Result<Vec<Feed>, String> {
    let feeds = sqlx::query_as::<_, Feed>(
        "SELECT id, title, url, site_url, description, category_id, favicon_url, last_fetch_at, last_fetch_error, fetch_error_count, is_active, created_at, updated_at FROM feeds ORDER BY created_at DESC",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(feeds)
}

#[tauri::command]
pub async fn create_feed(
    state: State<'_, AppState>,
    title: String,
    url: String,
    site_url: Option<String>,
    description: Option<String>,
    category_id: Option<String>,
) -> Result<Feed, String> {
    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM feeds WHERE url = ? LIMIT 1")
        .bind(&url)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    if existing.is_some() {
        return Err("订阅源已存在".to_string());
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now();

    sqlx::query(
        "INSERT INTO feeds (id, title, url, site_url, description, category_id, favicon_url, last_fetch_at, last_fetch_error, fetch_error_count, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 1, ?, ?)",
    )
    .bind(&id)
    .bind(&title)
    .bind(&url)
    .bind(&site_url)
    .bind(&description)
    .bind(&category_id)
    .bind::<Option<String>>(None)
    .bind(now)
    .bind(now)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(Feed {
        id,
        title,
        url,
        site_url,
        description,
        category_id,
        favicon_url: None,
        last_fetch_at: None,
        last_fetch_error: None,
        fetch_error_count: 0,
        is_active: true,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
pub async fn update_feed(
    state: State<'_, AppState>,
    feed_id: String,
    title: String,
    url: String,
    site_url: Option<String>,
    description: Option<String>,
    category_id: Option<String>,
) -> Result<Feed, String> {
    let existing: Option<String> =
        sqlx::query_scalar("SELECT id FROM feeds WHERE url = ? AND id != ? LIMIT 1")
            .bind(&url)
            .bind(&feed_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| e.to_string())?;

    if existing.is_some() {
        return Err("订阅源已存在".to_string());
    }

    let now = Utc::now();
    sqlx::query(
        "UPDATE feeds SET title = ?, url = ?, site_url = ?, description = ?, category_id = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&title)
    .bind(&url)
    .bind(&site_url)
    .bind(&description)
    .bind(&category_id)
    .bind(now)
    .bind(&feed_id)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let updated = sqlx::query_as::<_, Feed>(
        "SELECT id, title, url, site_url, description, category_id, favicon_url, last_fetch_at, last_fetch_error, fetch_error_count, is_active, created_at, updated_at FROM feeds WHERE id = ?",
    )
    .bind(&feed_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(updated)
}

#[tauri::command]
pub async fn update_feed_category(
    state: State<'_, AppState>,
    feed_id: String,
    category_id: Option<String>,
) -> Result<Feed, String> {
    let now = Utc::now();
    sqlx::query("UPDATE feeds SET category_id = ?, updated_at = ? WHERE id = ?")
        .bind(&category_id)
        .bind(now)
        .bind(&feed_id)
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    let updated = sqlx::query_as::<_, Feed>(
        "SELECT id, title, url, site_url, description, category_id, favicon_url, last_fetch_at, last_fetch_error, fetch_error_count, is_active, created_at, updated_at FROM feeds WHERE id = ?",
    )
    .bind(&feed_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(updated)
}

#[tauri::command]
pub async fn update_feed_favicon(
    state: State<'_, AppState>,
    feed_id: String,
    favicon_url: Option<String>,
) -> Result<Feed, String> {
    let now = Utc::now();
    sqlx::query("UPDATE feeds SET favicon_url = ?, updated_at = ? WHERE id = ?")
        .bind(&favicon_url)
        .bind(now)
        .bind(&feed_id)
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    let updated = sqlx::query_as::<_, Feed>(
        "SELECT id, title, url, site_url, description, category_id, favicon_url, last_fetch_at, last_fetch_error, fetch_error_count, is_active, created_at, updated_at FROM feeds WHERE id = ?",
    )
    .bind(&feed_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(updated)
}

#[tauri::command]
pub async fn delete_feed(state: State<'_, AppState>, feed_id: String) -> Result<(), String> {
    sqlx::query("DELETE FROM feeds WHERE id = ?")
        .bind(&feed_id)
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn list_articles(
    state: State<'_, AppState>,
    feed_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<Article>, String> {
    let limit = limit.unwrap_or(50);

    let articles = if let Some(feed_id) = feed_id {
        sqlx::query_as::<_, Article>(
            "SELECT id, feed_id, title, url, author, pub_date, summary, content, content_extracted, is_read, is_favorite, read_progress, fetched_at, created_at, updated_at FROM articles WHERE feed_id = ? ORDER BY pub_date DESC LIMIT ?",
        )
        .bind(feed_id)
        .bind(limit)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())?
    } else {
        sqlx::query_as::<_, Article>(
            "SELECT id, feed_id, title, url, author, pub_date, summary, content, content_extracted, is_read, is_favorite, read_progress, fetched_at, created_at, updated_at FROM articles ORDER BY pub_date DESC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())?
    };

    Ok(articles)
}

#[tauri::command]
pub async fn fetch_article_content(
    state: State<'_, AppState>,
    article_id: String,
) -> Result<Article, String> {
    let article = sqlx::query_as::<_, Article>(
        "SELECT id, feed_id, title, url, author, pub_date, summary, content, content_extracted, is_read, is_favorite, read_progress, fetched_at, created_at, updated_at FROM articles WHERE id = ?",
    )
    .bind(&article_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    if article.content.is_some() && article.content_extracted {
        return Ok(article);
    }

    if article.url.is_empty() {
        return Ok(article);
    }

    let mut content = ContentService::extract_full_text(&article.url)
        .await
        .map_err(|e| e.to_string())?;
    content.retain(|ch| {
        if ch == '\u{0000}' {
            return false;
        }
        if ch.is_control() {
            return ch == '\n' || ch == '\r' || ch == '\t';
        }
        true
    });

    let now = Utc::now();
    sqlx::query(
        "UPDATE articles SET content = ?, content_extracted = 1, updated_at = ? WHERE id = ?",
    )
    .bind(&content)
    .bind(now)
    .bind(&article_id)
    .execute(&state.pool)
    .await
    .map_err(|e| format!("update article content failed (len={}): {e}", content.len()))?;

    let updated = sqlx::query_as::<_, Article>(
        "SELECT id, feed_id, title, url, author, pub_date, summary, content, content_extracted, is_read, is_favorite, read_progress, fetched_at, created_at, updated_at FROM articles WHERE id = ?",
    )
    .bind(&article_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(updated)
}

#[tauri::command]
pub async fn update_article_progress(
    state: State<'_, AppState>,
    article_id: String,
    read_progress: f64,
    is_read: bool,
) -> Result<(), String> {
    let now = Utc::now();
    sqlx::query(
        "UPDATE articles SET read_progress = ?, is_read = ?, updated_at = ? WHERE id = ?",
    )
    .bind(read_progress)
    .bind(is_read)
    .bind(now)
    .bind(&article_id)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn update_article_flags(
    state: State<'_, AppState>,
    article_id: String,
    is_read: bool,
    is_favorite: bool,
) -> Result<Article, String> {
    let now = Utc::now();
    sqlx::query(
        "UPDATE articles SET is_read = ?, is_favorite = ?, updated_at = ? WHERE id = ?",
    )
    .bind(is_read)
    .bind(is_favorite)
    .bind(now)
    .bind(&article_id)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let updated = sqlx::query_as::<_, Article>(
        "SELECT id, feed_id, title, url, author, pub_date, summary, content, content_extracted, is_read, is_favorite, read_progress, fetched_at, created_at, updated_at FROM articles WHERE id = ?",
    )
    .bind(&article_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(updated)
}

#[tauri::command]
pub async fn fetch_feed_articles(
    state: State<'_, AppState>,
    feed_id: String,
    limit: Option<i64>,
) -> Result<i64, String> {
    let feed = sqlx::query_as::<_, Feed>(
        "SELECT id, title, url, site_url, description, category_id, favicon_url, last_fetch_at, last_fetch_error, fetch_error_count, is_active, created_at, updated_at FROM feeds WHERE id = ?",
    )
    .bind(&feed_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let service = FeedService::new();
    let parsed = match service.fetch_and_parse(&feed.url).await {
        Ok(parsed) => parsed,
        Err(error) => {
            sqlx::query(
                "UPDATE feeds SET last_fetch_error = ?, fetch_error_count = fetch_error_count + 1, updated_at = ? WHERE id = ?",
            )
            .bind(error.to_string())
            .bind(Utc::now())
            .bind(&feed_id)
            .execute(&state.pool)
            .await
            .map_err(|e| e.to_string())?;
            return Err(format!("{}: {}", feed.url, error));
        }
    };

    let max_entries = limit.unwrap_or(30) as usize;
    let mut inserted: i64 = 0;

    for entry in parsed.entries.into_iter().take(max_entries) {
        if entry.url.is_empty() {
            continue;
        }

        let existing: Option<String> = sqlx::query_scalar(
            "SELECT id FROM articles WHERE feed_id = ? AND url = ? LIMIT 1",
        )
        .bind(&feed_id)
        .bind(&entry.url)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

        if existing.is_some() {
            continue;
        }

        let now = Utc::now();
        let summary = entry
            .summary
            .clone()
            .or_else(|| entry.content.clone());

        sqlx::query(
            "INSERT INTO articles (id, feed_id, title, url, author, pub_date, summary, content, content_extracted, is_read, is_favorite, read_progress, fetched_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&feed_id)
        .bind(&entry.title)
        .bind(&entry.url)
        .bind(&entry.author)
        .bind(entry.pub_date)
        .bind(summary)
        .bind(None::<String>)
        .bind(false)
        .bind(false)
        .bind(false)
        .bind(0.0_f64)
        .bind(now)
        .bind(now)
        .bind(now)
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

        inserted += 1;
    }

    sqlx::query(
        "UPDATE feeds SET last_fetch_at = ?, last_fetch_error = NULL, fetch_error_count = 0, updated_at = ? WHERE id = ?",
    )
    .bind(Utc::now())
    .bind(Utc::now())
    .bind(&feed_id)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(inserted)
}
