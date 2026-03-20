use crate::models::{Article, ArticleAiAnalysis, Category, Feed};
use crate::services::ai_service;
use crate::services::content_service::ContentService;
use crate::services::feed_service::FeedService;
use crate::services::feed_service::ParsedEntry;
use crate::services::web_source_service::{GenericJsonConfig, WebSourceService};
use chrono::Utc;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

const FEED_SOURCE_RSS: &str = "rss";
const FEED_SOURCE_WEB_API: &str = "web_api";

pub struct AppState {
    pub pool: SqlitePool,
}

#[tauri::command]
pub async fn get_setting(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(&key)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_setting(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(&key)
        .bind(&value)
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn suggest_source_config(url: String) -> Result<Value, String> {
    if let Some(guest_suid) = extract_qq_guest_suid(&url) {
        return Ok(json!({
            "sourceType": FEED_SOURCE_WEB_API,
            "sourceConfig": {
                "provider": "qq_author",
                "guest_suid": guest_suid,
                "tab_id": "om_article"
            }
        }));
    }

    if let Some(column_id) = extract_tencent_column_id(&url) {
        return Ok(json!({
            "sourceType": FEED_SOURCE_WEB_API,
            "sourceConfig": {
                "provider": "generic_json",
                "method": "POST",
                "endpoint": "https://cloud.tencent.com/developer/api/column/getArticlesByColumnId",
                "body": {
                    "pageNumber": "{{next}}",
                    "columnId": column_id,
                    "tagId": -1,
                    "keyword": ""
                },
                "items_path": "list",
                "fields": {
                    "title": "title",
                    "url": "url",
                    "url_template": "https://cloud.tencent.com/developer/article/{{articleId}}",
                    "summary": "summary",
                    "pub_date": "createTime"
                },
                "pagination": {
                    "mode": "page_number",
                    "start": "1",
                    "max_pages": 20
                }
            }
        }));
    }

    Ok(json!({
        "sourceType": FEED_SOURCE_RSS,
        "sourceConfig": Value::Null
    }))
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
        "SELECT id, title, url, source_type, source_config, site_url, description, category_id, favicon_url, last_fetch_at, last_fetch_error, fetch_error_count, is_active, created_at, updated_at FROM feeds ORDER BY created_at DESC",
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
    source_type: Option<String>,
    source_config: Option<String>,
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
    let (source_type, source_config) = normalize_source_config(&url, source_type, source_config);

    sqlx::query(
        "INSERT INTO feeds (id, title, url, source_type, source_config, site_url, description, category_id, favicon_url, last_fetch_at, last_fetch_error, fetch_error_count, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 1, ?, ?)",
    )
    .bind(&id)
    .bind(&title)
    .bind(&url)
    .bind(&source_type)
    .bind(&source_config)
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
        source_type,
        source_config,
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
    source_type: Option<String>,
    source_config: Option<String>,
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

    let (source_type, source_config) = normalize_source_config(&url, source_type, source_config);
    let now = Utc::now();
    sqlx::query(
        "UPDATE feeds SET title = ?, url = ?, source_type = ?, source_config = ?, site_url = ?, description = ?, category_id = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&title)
    .bind(&url)
    .bind(&source_type)
    .bind(&source_config)
    .bind(&site_url)
    .bind(&description)
    .bind(&category_id)
    .bind(now)
    .bind(&feed_id)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let updated = sqlx::query_as::<_, Feed>(
        "SELECT id, title, url, source_type, source_config, site_url, description, category_id, favicon_url, last_fetch_at, last_fetch_error, fetch_error_count, is_active, created_at, updated_at FROM feeds WHERE id = ?",
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
        "SELECT id, title, url, source_type, source_config, site_url, description, category_id, favicon_url, last_fetch_at, last_fetch_error, fetch_error_count, is_active, created_at, updated_at FROM feeds WHERE id = ?",
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
        "SELECT id, title, url, source_type, source_config, site_url, description, category_id, favicon_url, last_fetch_at, last_fetch_error, fetch_error_count, is_active, created_at, updated_at FROM feeds WHERE id = ?",
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

    if !ContentService::should_extract(&article.url, article.summary.as_deref()) {
        return Ok(article);
    }

    if article.url.is_empty() {
        return Ok(article);
    }

    let mut content = match ContentService::extract_full_text(&article.url).await {
        Ok(content) => content,
        Err(error) => {
            eprintln!("Failed to extract content for {}: {}", article.url, error);
            return Err(format!("全文抓取失败: {}", error));
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
    mode: Option<String>,
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
    let mode = mode.unwrap_or_else(|| "summary".to_string());
    let ai_config = ai_service::load_config(&state.pool).await?;
    let (system_prompt, user_prompt) = match mode.as_str() {
        "research" => (
            "你是科研阅读助理。请从研究问题、方法、贡献、局限四个方面解读内容。输出务必专业、简洁、结构化。",
            format!(
                "标题: {}\n摘要/内容: {}\n\n请输出 JSON，字段为:\nsummary_zh: 用 2-4 句概括这篇内容的研究目标、方法与结论\nscore: 0-100 的相关性/研究价值分数\nnotes: 3-5 条要点，重点写研究问题、方法亮点、主要贡献、局限或需要验证之处",
                article.title,
                text
            ),
        ),
        "critical" => (
            "你是批判性阅读助手。请识别论证中的假设、证据强弱、可能漏洞和需要进一步验证的部分。保持克制，不要无根据否定。",
            format!(
                "标题: {}\n摘要/内容: {}\n\n请输出 JSON，字段为:\nsummary_zh: 用 2-4 句概括文章核心观点，并指出最值得警惕的地方\nscore: 0-100 的可信度/说服力分数\nnotes: 3-5 条批判性要点，重点写假设、证据、漏洞、遗漏视角、需补充的数据或实验",
                article.title,
                text
            ),
        ),
        "industry" => (
            "你是产业分析助手。请从应用价值、行业影响、落地难点、商业意义角度解读内容。",
            format!(
                "标题: {}\n摘要/内容: {}\n\n请输出 JSON，字段为:\nsummary_zh: 用 2-4 句概括文章对行业/产品/市场的意义\nscore: 0-100 的产业相关性分数\nnotes: 3-5 条要点，重点写潜在应用场景、受影响行业、落地门槛、商业价值与风险",
                article.title,
                text
            ),
        ),
        "xray" => (
            "你是 X（Twitter）舆情与传播分析助手。请基于文章标题和摘要，推测它在 X 上可能引发的讨论、支持与质疑点、传播标签和受众兴趣。不要假装引用不存在的具体帖子；如果没有实时贴文上下文，就输出高可信的舆情推断。",
            format!(
                "标题: {}\n摘要/内容: {}\n\n请输出 JSON，字段为:\nsummary_zh: 用 2-4 句概括这篇内容在 X 上可能会如何被讨论，以及核心舆论焦点\nscore: 0-100 的 X 传播潜力/讨论热度分数\nnotes: 3-5 条要点，重点写潜在讨论人群、支持点、争议点、适合的标签/关键词、可能引发转发讨论的角度。不要编造具体账号或具体贴文内容",
                article.title,
                text
            ),
        ),
        _ => (
            "你是科研阅读助理。请根据论文标题与摘要输出简洁的中文意译与要点。",
            format!(
                "标题: {}\n摘要: {}\n\n请输出 JSON，字段为:\nsummary_zh: 中文意译（口语化但专业，2-4 句）\nscore: 0-100 的相关性分数\nnotes: 核心贡献或要点（3-5 条，数组或多行文本）",
                article.title,
                text
            ),
        ),
    };

    let parsed = ai_service::chat_json(&state.pool, system_prompt, &user_prompt, 0.3, 800).await?;
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
        "INSERT INTO article_ai_analyses (id, article_id, provider, model, mode, summary, score, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&article_id)
    .bind(&ai_config.provider)
    .bind(&ai_config.model)
    .bind(&mode)
    .bind(&summary)
    .bind(score)
    .bind(&notes)
    .bind(now)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

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
pub async fn list_article_ai_analyses(
    state: State<'_, AppState>,
    article_id: String,
) -> Result<Vec<ArticleAiAnalysis>, String> {
    sqlx::query_as::<_, ArticleAiAnalysis>(
        "SELECT id, article_id, provider, model, mode, summary, score, notes, created_at FROM article_ai_analyses WHERE article_id = ? ORDER BY created_at DESC",
    )
    .bind(article_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())
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
        "SELECT id, title, url, source_type, source_config, site_url, description, category_id, favicon_url, last_fetch_at, last_fetch_error, fetch_error_count, is_active, created_at, updated_at FROM feeds WHERE id = ?",
    )
    .bind(&feed_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let max_entries = limit.unwrap_or(30) as usize;
    let source_type = feed.source_type.as_str();
    let entries = if source_type == FEED_SOURCE_WEB_API {
        fetch_web_source_entries(&feed, max_entries).await
    } else {
        fetch_rss_entries(&feed, max_entries).await
    };

    let entries = match entries {
        Ok(items) => items,
        Err(error) => {
            sqlx::query(
                "UPDATE feeds SET last_fetch_error = ?, fetch_error_count = fetch_error_count + 1, updated_at = ? WHERE id = ?",
            )
            .bind(error.clone())
            .bind(Utc::now())
            .bind(&feed_id)
            .execute(&state.pool)
            .await
            .map_err(|e| e.to_string())?;
            return Err(format!("{}: {}", feed.url, error));
        }
    };

    let inserted = insert_entries(&state.pool, &feed, entries, max_entries).await?;

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

async fn fetch_rss_entries(feed: &Feed, max_entries: usize) -> Result<Vec<ParsedEntry>, String> {
    let service = FeedService::new();
    let parsed = service
        .fetch_and_parse(&feed.url)
        .await
        .map_err(|e| e.to_string())?;
    Ok(parsed.entries.into_iter().take(max_entries).collect())
}

async fn fetch_web_source_entries(feed: &Feed, max_entries: usize) -> Result<Vec<ParsedEntry>, String> {
    let config = feed.source_config.as_deref().unwrap_or("{}");
    let value: Value = serde_json::from_str(config).map_err(|e| format!("source_config 无效: {e}"))?;
    let provider = value["provider"].as_str().unwrap_or("");

    let service = WebSourceService::new();

    if provider == "generic_json" {
        let mut generic: GenericJsonConfig =
            serde_json::from_value(value).map_err(|e| format!("generic_json 配置无效: {e}"))?;
        if generic.endpoint.trim().is_empty() {
            generic.endpoint = feed.url.clone();
        }
        let generic = generic.normalized();
        return service
            .fetch_generic_json(&generic, max_entries)
            .await
            .map_err(|e| e.to_string());
    }

    if provider != "qq_author" {
        return Err(format!("不支持的 web_api provider: {provider}"));
    }

    let guest_suid = value["guest_suid"].as_str().ok_or_else(|| "缺少 guest_suid 配置".to_string())?;
    let tab_id = value["tab_id"].as_str().unwrap_or("om_article");
    service
        .fetch_qq_author_articles(guest_suid, tab_id, max_entries)
        .await
        .map_err(|e| e.to_string())
}

async fn insert_entries(
    pool: &SqlitePool,
    feed: &Feed,
    entries: Vec<ParsedEntry>,
    max_entries: usize,
) -> Result<i64, String> {
    let mut inserted: i64 = 0;

    for entry in entries.into_iter().take(max_entries) {
        if entry.url.is_empty() {
            continue;
        }

        let existing: Option<String> = sqlx::query_scalar(
            "SELECT id FROM articles WHERE feed_id = ? AND url = ? LIMIT 1",
        )
        .bind(&feed.id)
        .bind(&entry.url)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

        if existing.is_some() {
            continue;
        }

        let now = Utc::now();
        let summary = entry.summary.clone().or_else(|| entry.content.clone());
        let content = entry.content.clone().filter(|value| !value.trim().is_empty());
        let content_extracted = content.is_some();

        sqlx::query(
            "INSERT INTO articles (id, feed_id, title, url, author, pub_date, summary, content, content_extracted, is_read, is_favorite, read_progress, fetched_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&feed.id)
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
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

        inserted += 1;
    }

    Ok(inserted)
}

fn normalize_source_config(
    url: &str,
    source_type: Option<String>,
    source_config: Option<String>,
) -> (String, Option<String>) {
    let source_type = source_type.unwrap_or_else(|| FEED_SOURCE_RSS.to_string());
    if source_type == FEED_SOURCE_WEB_API {
        if source_config.is_none() {
            if let Some(guest_suid) = extract_qq_guest_suid(url) {
                let config = json!({
                    "provider": "qq_author",
                    "guest_suid": guest_suid,
                    "tab_id": "om_article"
                });
                return (source_type, Some(config.to_string()));
            }
        }
        return (source_type, source_config);
    }

    if let Some(guest_suid) = extract_qq_guest_suid(url) {
        let config = json!({
            "provider": "qq_author",
            "guest_suid": guest_suid,
            "tab_id": "om_article"
        });
        return (FEED_SOURCE_WEB_API.to_string(), Some(config.to_string()));
    }

    (source_type, source_config)
}

fn extract_qq_guest_suid(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if parsed.domain() != Some("news.qq.com") {
        return None;
    }
    let mut segments = parsed.path_segments()?;
    let first = segments.next()?;
    let second = segments.next()?;
    let third = segments.next()?;
    if first != "omn" || second != "author" {
        return None;
    }
    let normalized = third
        .replace("%3D", "=")
        .replace("%3d", "=")
        .replace("%2B", "+")
        .replace("%2b", "+");
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn extract_tencent_column_id(url: &str) -> Option<i64> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if parsed.domain() != Some("cloud.tencent.com") {
        return None;
    }
    let mut segments = parsed.path_segments()?;
    let first = segments.next()?;
    let second = segments.next()?;
    let third = segments.next()?;
    if first != "developer" || second != "column" {
        return None;
    }
    third.parse::<i64>().ok()
}
