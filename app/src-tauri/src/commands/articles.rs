use super::{db_err, AppState};
use crate::models::{Article, ArticleListItem, ARTICLE_LIST_SELECT, ARTICLE_SELECT};
use crate::services::content_service;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, Sqlite, SqlitePool};
use tauri::State;

#[derive(Debug, Clone, Deserialize)]
pub struct Scope {
    /// "all" | "category" | "uncategorized" | "feed" | "favorites"
    pub kind: String,
    pub id: Option<String>,
}

fn push_scope(qb: &mut QueryBuilder<'_, Sqlite>, scope: &Scope) {
    match scope.kind.as_str() {
        "feed" => {
            qb.push(" AND a.feed_id = ").push_bind(scope.id.clone().unwrap_or_default());
        }
        "category" => {
            qb.push(" AND f.category_id = ").push_bind(scope.id.clone().unwrap_or_default());
        }
        "uncategorized" => {
            qb.push(" AND a.feed_id IS NOT NULL AND f.category_id IS NULL");
        }
        "favorites" => {
            qb.push(" AND a.is_favorite = 1");
        }
        "later" => {
            qb.push(" AND a.read_later = 1");
        }
        _ => {
            // "all": everything still attached to a feed; detached favorites live under "favorites".
            qb.push(" AND a.feed_id IS NOT NULL");
        }
    }
}

pub(crate) async fn fetch_article(pool: &SqlitePool, id: &str) -> Result<Article, String> {
    sqlx::query_as::<_, Article>(&format!("{ARTICLE_SELECT} WHERE a.id = ?"))
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn list_articles(
    state: State<'_, AppState>,
    scope: Scope,
    unread_only: bool,
    search: Option<String>,
    limit: i64,
    offset: i64,
) -> Result<Vec<ArticleListItem>, String> {
    let mut qb = QueryBuilder::<Sqlite>::new(ARTICLE_LIST_SELECT);
    qb.push(" WHERE 1 = 1");
    push_scope(&mut qb, &scope);
    if unread_only {
        qb.push(" AND a.is_read = 0");
    }
    if let Some(keyword) = search.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        let pattern = format!("%{}%", keyword.replace('%', "\\%").replace('_', "\\_"));
        qb.push(" AND (a.title LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR a.summary LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR a.author LIKE ")
            .push_bind(pattern)
            .push(" ESCAPE '\\')");
    }
    qb.push(" ORDER BY a.pub_date DESC, a.created_at DESC LIMIT ")
        .push_bind(limit.clamp(1, 500))
        .push(" OFFSET ")
        .push_bind(offset.max(0));

    qb.build_query_as::<ArticleListItem>()
        .fetch_all(&state.pool)
        .await
        .map_err(db_err)
}

#[derive(Debug, Serialize)]
pub struct Counts {
    pub unread: i64,
    pub favorites: i64,
    pub later: i64,
}

#[tauri::command]
pub async fn get_counts(state: State<'_, AppState>) -> Result<Counts, String> {
    let (unread, favorites, later): (i64, i64, i64) = sqlx::query_as(
        "SELECT \
           (SELECT COUNT(*) FROM articles WHERE is_read = 0 AND feed_id IS NOT NULL), \
           (SELECT COUNT(*) FROM articles WHERE is_favorite = 1), \
           (SELECT COUNT(*) FROM articles WHERE read_later = 1)",
    )
    .fetch_one(&state.pool)
    .await
    .map_err(db_err)?;
    Ok(Counts { unread, favorites, later })
}

#[tauri::command]
pub async fn get_article(state: State<'_, AppState>, article_id: String) -> Result<Article, String> {
    fetch_article(&state.pool, &article_id).await
}

/// Ensures the article has its full text, pulling and extracting the web page if the
/// feed only shipped a teaser. `force` re-extracts even when content exists.
#[tauri::command]
pub async fn load_full_content(
    state: State<'_, AppState>,
    article_id: String,
    force: Option<bool>,
) -> Result<Article, String> {
    let article = fetch_article(&state.pool, &article_id).await?;
    let force = force.unwrap_or(false);
    if !force
        && (article.content_extracted
            || !content_service::needs_extraction(article.content.as_deref(), article.summary.as_deref()))
    {
        return Ok(article);
    }
    if article.url.trim().is_empty() {
        return Ok(article);
    }

    let content = content_service::extract_full_text(&state.http, &article.url).await?;
    sqlx::query("UPDATE articles SET content = ?, content_extracted = 1, updated_at = ? WHERE id = ?")
        .bind(&content)
        .bind(Utc::now())
        .bind(&article_id)
        .execute(&state.pool)
        .await
        .map_err(db_err)?;
    fetch_article(&state.pool, &article_id).await
}

#[tauri::command]
pub async fn set_read(state: State<'_, AppState>, article_ids: Vec<String>, is_read: bool) -> Result<(), String> {
    let mut tx = state.pool.begin().await.map_err(db_err)?;
    for id in &article_ids {
        sqlx::query("UPDATE articles SET is_read = ?, updated_at = ? WHERE id = ?")
            .bind(is_read)
            .bind(Utc::now())
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    tx.commit().await.map_err(db_err)
}

#[tauri::command]
pub async fn mark_scope_read(state: State<'_, AppState>, scope: Scope) -> Result<u64, String> {
    let mut qb = QueryBuilder::<Sqlite>::new("UPDATE articles SET is_read = 1 WHERE is_read = 0 AND id IN (SELECT a.id FROM articles a LEFT JOIN feeds f ON f.id = a.feed_id WHERE 1 = 1");
    push_scope(&mut qb, &scope);
    qb.push(")");
    let result = qb.build().execute(&state.pool).await.map_err(db_err)?;
    Ok(result.rows_affected())
}

/// Un-favoriting also drops the local archive to free space.
#[tauri::command]
pub async fn set_favorite(state: State<'_, AppState>, article_id: String, is_favorite: bool) -> Result<(), String> {
    let sql = if is_favorite {
        "UPDATE articles SET is_favorite = 1, updated_at = ? WHERE id = ?"
    } else {
        "UPDATE articles SET is_favorite = 0, archived_html = NULL, archived_at = NULL, updated_at = ? WHERE id = ?"
    };
    sqlx::query(sql)
        .bind(Utc::now())
        .bind(&article_id)
        .execute(&state.pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

#[tauri::command]
pub async fn set_read_later(state: State<'_, AppState>, article_id: String, read_later: bool) -> Result<(), String> {
    sqlx::query("UPDATE articles SET read_later = ?, updated_at = ? WHERE id = ?")
        .bind(read_later)
        .bind(Utc::now())
        .bind(&article_id)
        .execute(&state.pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

#[tauri::command]
pub async fn update_progress(state: State<'_, AppState>, article_id: String, progress: f64) -> Result<(), String> {
    let progress = progress.clamp(0.0, 100.0);
    sqlx::query(
        "UPDATE articles SET read_progress = ?, is_read = CASE WHEN ? >= 95 THEN 1 ELSE is_read END WHERE id = ?",
    )
    .bind(progress)
    .bind(progress)
    .bind(&article_id)
    .execute(&state.pool)
    .await
    .map_err(db_err)?;
    Ok(())
}

#[tauri::command]
pub async fn fetch_image(state: State<'_, AppState>, url: String) -> Result<String, String> {
    content_service::fetch_image_data_uri(&state.http, &url).await
}

/// Stores the cleaned, image-inlined HTML so the article survives the source going away.
#[tauri::command]
pub async fn save_archive(state: State<'_, AppState>, article_id: String, html: String) -> Result<(), String> {
    let feed_title: Option<String> = sqlx::query_scalar(
        "SELECT f.title FROM articles a JOIN feeds f ON f.id = a.feed_id WHERE a.id = ?",
    )
    .bind(&article_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(db_err)?;
    sqlx::query(
        "UPDATE articles SET archived_html = ?, archived_at = ?, feed_title = COALESCE(?, feed_title) WHERE id = ?",
    )
    .bind(&html)
    .bind(Utc::now())
    .bind(feed_title)
    .bind(&article_id)
    .execute(&state.pool)
    .await
    .map_err(db_err)?;
    Ok(())
}

/// Articles are kept for this many days unless favorited or queued for later.
pub const RETENTION_DAYS: i64 = 30;

pub fn retention_cutoff() -> chrono::DateTime<Utc> {
    Utc::now() - chrono::Duration::days(RETENTION_DAYS)
}

/// Housekeeping (startup and after every sync):
/// - drops articles older than the retention window that aren't favorited / read-later,
/// - drops detached articles that are no longer kept (unreachable),
/// - drops translation cache entries nobody has needed for a while.
pub async fn prune(pool: &SqlitePool) -> Result<u64, String> {
    let cutoff = retention_cutoff();
    let old = sqlx::query(
        "DELETE FROM articles WHERE is_favorite = 0 AND read_later = 0 \
         AND COALESCE(pub_date, fetched_at) < ?",
    )
    .bind(cutoff)
    .execute(pool)
    .await
    .map_err(db_err)?;
    sqlx::query("DELETE FROM articles WHERE feed_id IS NULL AND is_favorite = 0 AND read_later = 0")
        .execute(pool)
        .await
        .map_err(db_err)?;
    sqlx::query("DELETE FROM translations WHERE created_at < ?")
        .bind(Utc::now() - chrono::Duration::days(RETENTION_DAYS * 3))
        .execute(pool)
        .await
        .map_err(db_err)?;
    Ok(old.rows_affected())
}
