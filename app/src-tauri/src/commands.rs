use crate::models::{Article, Category, Feed};
use crate::services::content_service::ContentService;
use crate::services::feed_service::FeedService;
use chrono::Utc;
use serde_json::{json, Value};
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
            "SELECT id, feed_id, title, url, author, pub_date, summary, content, content_extracted, ai_summary, ai_score, ai_notes, ai_updated_at, is_read, is_favorite, read_progress, fetched_at, created_at, updated_at FROM articles WHERE feed_id = ? ORDER BY pub_date DESC LIMIT ?",
        )
        .bind(feed_id)
        .bind(limit)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())?
    } else {
        sqlx::query_as::<_, Article>(
            "SELECT id, feed_id, title, url, author, pub_date, summary, content, content_extracted, ai_summary, ai_score, ai_notes, ai_updated_at, is_read, is_favorite, read_progress, fetched_at, created_at, updated_at FROM articles ORDER BY pub_date DESC LIMIT ?",
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
        "SELECT id, feed_id, title, url, author, pub_date, summary, content, content_extracted, ai_summary, ai_score, ai_notes, ai_updated_at, is_read, is_favorite, read_progress, fetched_at, created_at, updated_at FROM articles WHERE id = ?",
    )
    .bind(&article_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    if article.content.is_some() && article.content_extracted {
        return Ok(article);
    }

    if !ContentService::should_extract(article.summary.as_deref()) {
        return Ok(article);
    }

    if article.url.is_empty() {
        return Ok(article);
    }

    let mut content = match ContentService::extract_full_text(&article.url).await {
        Ok(content) => content,
        Err(error) => {
            eprintln!("Failed to extract content for {}: {}", article.url, error);
            return Ok(article);
        }
    };
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
        "SELECT id, feed_id, title, url, author, pub_date, summary, content, content_extracted, ai_summary, ai_score, ai_notes, ai_updated_at, is_read, is_favorite, read_progress, fetched_at, created_at, updated_at FROM articles WHERE id = ?",
    )
    .bind(&article_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(updated)
}

#[tauri::command]
pub async fn analyze_article(
    state: State<'_, AppState>,
    article_id: String,
    force: Option<bool>,
) -> Result<Article, String> {
    let article = sqlx::query_as::<_, Article>(
        "SELECT id, feed_id, title, url, author, pub_date, summary, content, content_extracted, ai_summary, ai_score, ai_notes, ai_updated_at, is_read, is_favorite, read_progress, fetched_at, created_at, updated_at FROM articles WHERE id = ?",
    )
    .bind(&article_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    if force.unwrap_or(false) == false && article.ai_summary.is_some() {
        return Ok(article);
    }

    let api_key = std::env::var("DEEPSEEK_API_KEY")
        .map_err(|_| "缺少 DEEPSEEK_API_KEY 环境变量".to_string())?;

    let source = article
        .summary
        .clone()
        .or_else(|| article.content.clone())
        .unwrap_or_default();
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("文章内容为空，无法分析".to_string());
    }

    let text: String = trimmed.chars().take(4000).collect();
    let system_prompt = "你是科研阅读助理。请根据论文标题与摘要输出简洁的中文意译与要点。";
    let user_prompt = format!(
        "标题: {}\n摘要: {}\n\n请输出 JSON，字段为:\nsummary_zh: 中文意译（口语化但专业，2-4 句）\nscore: 0-100 的相关性分数\nnotes: 核心贡献或要点（3-5 条，数组或多行文本）",
        article.title,
        text
    );

    let payload = json!({
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.3,
        "max_tokens": 800
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post("https://api.deepseek.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("AI 请求失败: {} {}", status, body));
    }

    let response_json: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let content = response_json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "AI 返回内容为空".to_string())?;

    let trimmed = content.trim();
    let json_text = if trimmed.starts_with("{") {
        trimmed.to_string()
    } else if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        trimmed[start..=end].to_string()
    } else {
        trimmed.to_string()
    };

    let parsed: Value = serde_json::from_str(&json_text).map_err(|e| {
        format!("AI 返回不是 JSON: {e} | raw={}", trimmed)
    })?;
    let summary = parsed["summary_zh"].as_str().unwrap_or("").trim().to_string();
    let score = parsed["score"].as_i64().or_else(|| {
        parsed["score"].as_str().and_then(|value| value.parse::<i64>().ok())
    });

    let notes = if let Some(items) = parsed["notes"].as_array() {
        let list = items
            .iter()
            .filter_map(|item| item.as_str())
            .collect::<Vec<_>>();
        if list.is_empty() {
            String::new()
        } else {
            format!("- {}", list.join("\n- "))
        }
    } else {
        parsed["notes"].as_str().unwrap_or("").trim().to_string()
    };

    let now = Utc::now();
    sqlx::query(
        "UPDATE articles SET ai_summary = ?, ai_score = ?, ai_notes = ?, ai_updated_at = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&summary)
    .bind(score)
    .bind(&notes)
    .bind(now)
    .bind(now)
    .bind(&article_id)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let updated = sqlx::query_as::<_, Article>(
        "SELECT id, feed_id, title, url, author, pub_date, summary, content, content_extracted, ai_summary, ai_score, ai_notes, ai_updated_at, is_read, is_favorite, read_progress, fetched_at, created_at, updated_at FROM articles WHERE id = ?",
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
        "SELECT id, feed_id, title, url, author, pub_date, summary, content, content_extracted, ai_summary, ai_score, ai_notes, ai_updated_at, is_read, is_favorite, read_progress, fetched_at, created_at, updated_at FROM articles WHERE id = ?",
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

    let is_arxiv = feed.url.contains("arxiv.org/rss") || feed.url.contains("export.arxiv.org/rss");

    for entry in parsed.entries.into_iter().take(max_entries) {
        if entry.url.is_empty() {
            continue;
        }

        if let (Some(last_fetch_at), Some(pub_date)) = (feed.last_fetch_at, entry.pub_date) {
            if pub_date <= last_fetch_at {
                continue;
            }
        }

        if is_arxiv {
            let summary_text = entry
                .summary
                .as_deref()
                .or(entry.content.as_deref())
                .unwrap_or("");
            let summary_lower = summary_text.to_lowercase();
            if !summary_lower.contains("large language model")
                || summary_lower.contains("biology")
            {
                continue;
            }
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
        let content = entry.content.clone().filter(|value| !value.trim().is_empty());
        let content_extracted = content.is_some();

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
        .bind(content)
        .bind(content_extracted)
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
