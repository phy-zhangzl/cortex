use super::{db_err, AppState};
use super::articles::{prune, retention_cutoff};
use crate::models::{DiscoveredFeed, Feed, FeedHealth, SyncFailure, SyncReport, FEED_SELECT};
use crate::services::content_service;
use crate::services::feed_service::{self, ParsedEntry};
use chrono::Utc;
use serde::Deserialize;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Semaphore;
use uuid::Uuid;

const SYNC_CONCURRENCY: usize = 6;

async fn get_feed(pool: &SqlitePool, feed_id: &str) -> Result<Feed, String> {
    sqlx::query_as::<_, Feed>(&format!("{FEED_SELECT} WHERE f.id = ?"))
        .bind(feed_id)
        .fetch_one(pool)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn list_feeds(state: State<'_, AppState>) -> Result<Vec<Feed>, String> {
    sqlx::query_as::<_, Feed>(&format!("{FEED_SELECT} ORDER BY f.title COLLATE NOCASE"))
        .fetch_all(&state.pool)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn discover_feed(state: State<'_, AppState>, url: String) -> Result<DiscoveredFeed, String> {
    feed_service::discover(&state.http, &url).await
}

async fn insert_feed(
    pool: &SqlitePool,
    title: &str,
    url: &str,
    site_url: Option<&str>,
    category_id: Option<&str>,
) -> Result<Option<String>, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let result = sqlx::query(
        "INSERT OR IGNORE INTO feeds (id, title, url, site_url, category_id, fetch_error_count, is_active, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)",
    )
    .bind(&id)
    .bind(title.trim())
    .bind(url.trim())
    .bind(site_url)
    .bind(category_id)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .map_err(db_err)?;
    Ok((result.rows_affected() > 0).then_some(id))
}

#[tauri::command]
pub async fn create_feed(
    state: State<'_, AppState>,
    title: String,
    url: String,
    site_url: Option<String>,
    category_id: Option<String>,
) -> Result<Feed, String> {
    if title.trim().is_empty() || url.trim().is_empty() {
        return Err("标题和地址不能为空".to_string());
    }
    let id = insert_feed(&state.pool, &title, &url, site_url.as_deref(), category_id.as_deref())
        .await?
        .ok_or_else(|| "这个订阅源已经存在".to_string())?;
    // Pull the first batch right away so the new feed isn't empty.
    let _ = sync_one(&state.pool, &state.http, &id, &url).await;
    get_feed(&state.pool, &id).await
}

#[derive(Debug, Deserialize)]
pub struct ImportItem {
    pub title: String,
    pub url: String,
    pub site_url: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct ImportReport {
    pub added: usize,
    pub skipped: usize,
}

/// Bulk import (from OPML or an old Cortex JSON backup). Categories are matched by name.
#[tauri::command]
pub async fn import_feeds(state: State<'_, AppState>, items: Vec<ImportItem>) -> Result<ImportReport, String> {
    let mut added = 0;
    let mut skipped = 0;
    for item in items {
        if item.url.trim().is_empty() {
            skipped += 1;
            continue;
        }
        let category_id = match item.category.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
            Some(name) => Some(ensure_category(&state.pool, name).await?),
            None => None,
        };
        let title = if item.title.trim().is_empty() { item.url.clone() } else { item.title.clone() };
        match insert_feed(&state.pool, &title, &item.url, item.site_url.as_deref(), category_id.as_deref()).await? {
            Some(_) => added += 1,
            None => skipped += 1,
        }
    }
    Ok(ImportReport { added, skipped })
}

async fn ensure_category(pool: &SqlitePool, name: &str) -> Result<String, String> {
    if let Some(id) = sqlx::query_scalar::<_, String>("SELECT id FROM categories WHERE name = ?")
        .bind(name)
        .fetch_optional(pool)
        .await
        .map_err(db_err)?
    {
        return Ok(id);
    }
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO categories (id, name, parent_id, sort_order, created_at, updated_at) \
         VALUES (?, ?, NULL, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories), ?, ?)",
    )
    .bind(&id)
    .bind(name)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .map_err(db_err)?;
    Ok(id)
}

#[tauri::command]
pub async fn update_feed(
    state: State<'_, AppState>,
    feed_id: String,
    title: String,
    url: String,
    category_id: Option<String>,
) -> Result<Feed, String> {
    if title.trim().is_empty() || url.trim().is_empty() {
        return Err("标题和地址不能为空".to_string());
    }
    let duplicate: Option<String> = sqlx::query_scalar("SELECT id FROM feeds WHERE url = ? AND id != ?")
        .bind(url.trim())
        .bind(&feed_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(db_err)?;
    if duplicate.is_some() {
        return Err("已有另一个订阅源使用这个地址".to_string());
    }
    sqlx::query("UPDATE feeds SET title = ?, url = ?, category_id = ?, updated_at = ? WHERE id = ?")
        .bind(title.trim())
        .bind(url.trim())
        .bind(&category_id)
        .bind(Utc::now())
        .bind(&feed_id)
        .execute(&state.pool)
        .await
        .map_err(db_err)?;
    get_feed(&state.pool, &feed_id).await
}

#[tauri::command]
pub async fn move_feed(state: State<'_, AppState>, feed_id: String, category_id: Option<String>) -> Result<(), String> {
    sqlx::query("UPDATE feeds SET category_id = ?, updated_at = ? WHERE id = ?")
        .bind(&category_id)
        .bind(Utc::now())
        .bind(&feed_id)
        .execute(&state.pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

/// Per-feed activity numbers for the subscription manager.
#[tauri::command]
pub async fn feed_health(state: State<'_, AppState>) -> Result<Vec<FeedHealth>, String> {
    sqlx::query_as::<_, FeedHealth>(
        "SELECT f.id, f.title, f.url, f.site_url, f.category_id, f.created_at, f.last_fetch_at, f.last_fetch_error, \
           COALESCE(f.fetch_error_count, 0) AS fetch_error_count, f.latest_entry_at, \
           (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id AND a.pub_date >= ?) AS recent_count, \
           (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id AND a.is_read = 0) AS unread_count, \
           (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id AND a.is_favorite = 1) AS favorite_count \
         FROM feeds f ORDER BY f.title COLLATE NOCASE",
    )
    .bind(retention_cutoff())
    .fetch_all(&state.pool)
    .await
    .map_err(db_err)
}

/// Deletes a feed. Favorited / read-later articles are kept (detached, with the
/// feed title snapshotted) so saved reading never disappears with its source.
#[tauri::command]
pub async fn delete_feed(state: State<'_, AppState>, feed_id: String) -> Result<i64, String> {
    let mut tx = state.pool.begin().await.map_err(db_err)?;
    sqlx::query(
        "UPDATE articles SET feed_title = (SELECT title FROM feeds WHERE id = ?) WHERE feed_id = ? AND (is_favorite = 1 OR read_later = 1)",
    )
    .bind(&feed_id)
    .bind(&feed_id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    sqlx::query("DELETE FROM articles WHERE feed_id = ? AND is_favorite = 0 AND read_later = 0")
        .bind(&feed_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let kept: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM articles WHERE feed_id = ?")
        .bind(&feed_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    // ON DELETE SET NULL detaches the remaining (favorited) articles.
    sqlx::query("DELETE FROM feeds WHERE id = ?")
        .bind(&feed_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(kept)
}

/// Syncs the given feeds (or all feeds when `feed_ids` is None) concurrently.
#[tauri::command]
pub async fn sync_feeds(state: State<'_, AppState>, feed_ids: Option<Vec<String>>) -> Result<SyncReport, String> {
    let feeds: Vec<(String, String, String)> =
        sqlx::query_as("SELECT id, title, url FROM feeds WHERE is_active = 1")
            .fetch_all(&state.pool)
            .await
            .map_err(db_err)?;
    let feeds: Vec<_> = match feed_ids {
        Some(ids) => feeds.into_iter().filter(|(id, _, _)| ids.contains(id)).collect(),
        None => feeds,
    };

    let semaphore = Arc::new(Semaphore::new(SYNC_CONCURRENCY));
    let mut tasks = tokio::task::JoinSet::new();
    for (id, title, url) in feeds.iter().cloned() {
        let pool = state.pool.clone();
        let http = state.http.clone();
        let semaphore = semaphore.clone();
        tasks.spawn(async move {
            let _permit = semaphore.acquire_owned().await;
            let result = sync_one(&pool, &http, &id, &url).await;
            (id, title, result)
        });
    }

    let mut report = SyncReport {
        finished_at: Utc::now(),
        feeds: feeds.len(),
        new_articles: 0,
        failures: Vec::new(),
    };
    while let Some(joined) = tasks.join_next().await {
        match joined {
            Ok((_, _, Ok(count))) => report.new_articles += count,
            Ok((feed_id, title, Err(error))) => report.failures.push(SyncFailure { feed_id, title, error }),
            Err(e) => report.failures.push(SyncFailure {
                feed_id: String::new(),
                title: String::new(),
                error: e.to_string(),
            }),
        }
    }
    prune(&state.pool).await?;
    report.finished_at = Utc::now();
    Ok(report)
}

async fn sync_one(pool: &SqlitePool, http: &reqwest::Client, feed_id: &str, url: &str) -> Result<i64, String> {
    match feed_service::fetch_feed(http, url).await {
        Ok(parsed) => {
            let latest = parsed.entries.iter().filter_map(|e| e.pub_date).max();
            let inserted = insert_entries(pool, feed_id, parsed.entries).await?;
            sqlx::query(
                "UPDATE feeds SET last_fetch_at = ?, last_fetch_error = NULL, fetch_error_count = 0, \
                 site_url = COALESCE(site_url, ?), latest_entry_at = COALESCE(?, latest_entry_at) WHERE id = ?",
            )
            .bind(Utc::now())
            .bind(parsed.site_url)
            .bind(latest)
            .bind(feed_id)
            .execute(pool)
            .await
            .map_err(db_err)?;
            Ok(inserted)
        }
        Err(error) => {
            sqlx::query(
                "UPDATE feeds SET last_fetch_error = ?, fetch_error_count = fetch_error_count + 1 WHERE id = ?",
            )
            .bind(&error)
            .bind(feed_id)
            .execute(pool)
            .await
            .map_err(db_err)?;
            Err(error)
        }
    }
}

async fn insert_entries(pool: &SqlitePool, feed_id: &str, entries: Vec<ParsedEntry>) -> Result<i64, String> {
    let mut tx = pool.begin().await.map_err(db_err)?;
    let mut inserted = 0;
    let now = Utc::now();
    let cutoff = retention_cutoff();
    for entry in entries {
        // Outside the retention window: it would only be pruned (and come back as unread next sync).
        if entry.url.trim().is_empty() || entry.pub_date.is_some_and(|d| d < cutoff) {
            continue;
        }
        let content = entry.content.as_deref().map(content_service::strip_control_chars);
        let summary = entry
            .summary
            .as_deref()
            .or(content.as_deref())
            .map(content_service::strip_control_chars);
        let complete = content.is_some()
            && !content_service::needs_extraction(content.as_deref(), None);
        let result = sqlx::query(
            "INSERT OR IGNORE INTO articles (id, feed_id, title, url, author, pub_date, summary, content, \
             content_extracted, fetched_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(feed_id)
        .bind(&entry.title)
        .bind(entry.url.trim())
        .bind(&entry.author)
        .bind(entry.pub_date.unwrap_or(now))
        .bind(summary)
        .bind(content)
        .bind(complete)
        .bind(now)
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
        inserted += result.rows_affected() as i64;
    }
    tx.commit().await.map_err(db_err)?;
    Ok(inserted)
}

/// Writes the OPML the frontend built into ~/Downloads and returns the path.
#[tauri::command]
pub async fn export_opml(app: tauri::AppHandle, content: String) -> Result<String, String> {
    use tauri::Manager;
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let name = format!("cortex-feeds-{}.opml", Utc::now().format("%Y%m%d-%H%M%S"));
    let path = dir.join(name);
    tokio::fs::write(&path, content).await.map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Debug, Deserialize)]
pub struct ExportFile {
    /// Relative path inside the export folder, e.g. "2026-11-24 标题.md" or "assets/x.png".
    pub path: String,
    pub text: Option<String>,
    pub base64: Option<String>,
}

/// Writes a set of files into ~/Downloads/<folder> and returns the folder path.
#[tauri::command]
pub async fn export_files(app: tauri::AppHandle, folder: String, files: Vec<ExportFile>) -> Result<String, String> {
    use base64::Engine;
    use std::path::{Component, Path};
    use tauri::Manager;

    let safe = |p: &str| {
        let path = Path::new(p);
        !p.is_empty() && path.components().all(|c| matches!(c, Component::Normal(_)))
    };
    if !safe(&folder) {
        return Err("导出目录名无效".to_string());
    }
    let root = app.path().download_dir().map_err(|e| e.to_string())?.join(&folder);
    for file in files {
        if !safe(&file.path) {
            return Err(format!("文件名无效：{}", file.path));
        }
        let target = root.join(&file.path);
        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
        }
        let bytes = match (file.text, file.base64) {
            (Some(text), _) => text.into_bytes(),
            (None, Some(b64)) => base64::engine::general_purpose::STANDARD
                .decode(b64.as_bytes())
                .map_err(|e| e.to_string())?,
            _ => continue,
        };
        tokio::fs::write(&target, bytes).await.map_err(|e| e.to_string())?;
    }
    Ok(root.to_string_lossy().to_string())
}
