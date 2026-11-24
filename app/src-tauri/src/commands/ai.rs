use super::articles::fetch_article;
use super::{db_err, AppState};
use crate::models::LlmConfig;
use crate::services::llm_service;
use chrono::Utc;
use tauri::State;

#[tauri::command]
pub async fn get_llm_config(state: State<'_, AppState>) -> Result<LlmConfig, String> {
    llm_service::load_config(&state.pool).await
}

#[tauri::command]
pub async fn list_llm_models(state: State<'_, AppState>, base_url: String) -> Result<Vec<String>, String> {
    llm_service::list_models(&state.http, &base_url).await
}

/// Translates one block of text, served from the local cache when possible.
#[tauri::command]
pub async fn translate_text(state: State<'_, AppState>, text: String) -> Result<String, String> {
    let source = text.trim();
    if source.is_empty() {
        return Ok(String::new());
    }
    let config = llm_service::load_config(&state.pool).await?;
    let key = llm_service::cache_key(&config.target_lang, source);

    let cached: Option<(String, String)> =
        sqlx::query_as("SELECT source, translated FROM translations WHERE key = ?")
            .bind(&key)
            .fetch_optional(&state.pool)
            .await
            .map_err(db_err)?;
    if let Some((cached_source, translated)) = cached {
        if cached_source == source {
            return Ok(translated);
        }
    }

    let system = llm_service::translate_prompt(&config.target_lang);
    let translated = llm_service::chat(&state.http, &config, &system, source).await?;
    if !translated.is_empty() {
        sqlx::query(
            "INSERT INTO translations (key, target_lang, source, translated, created_at) VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT(key) DO UPDATE SET source = excluded.source, translated = excluded.translated",
        )
        .bind(&key)
        .bind(&config.target_lang)
        .bind(source)
        .bind(&translated)
        .bind(Utc::now())
        .execute(&state.pool)
        .await
        .map_err(db_err)?;
    }
    Ok(translated)
}

#[tauri::command]
pub async fn summarize_article(
    state: State<'_, AppState>,
    article_id: String,
    text: String,
) -> Result<String, String> {
    let article = fetch_article(&state.pool, &article_id).await?;
    let body: String = text.trim().chars().take(12_000).collect();
    if body.is_empty() {
        return Err("文章内容为空，无法摘要".to_string());
    }
    let config = llm_service::load_config(&state.pool).await?;
    let user = format!("标题：{}\n\n正文：\n{}", article.title, body);
    let summary = llm_service::chat(&state.http, &config, llm_service::SUMMARY_PROMPT, &user).await?;
    let now = Utc::now();
    sqlx::query("UPDATE articles SET ai_summary = ?, ai_updated_at = ? WHERE id = ?")
        .bind(&summary)
        .bind(now)
        .bind(&article_id)
        .execute(&state.pool)
        .await
        .map_err(db_err)?;
    Ok(summary)
}
