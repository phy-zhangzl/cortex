//! Talks to an Ollama server (native /api/chat) for translation and summaries.

use crate::models::LlmConfig;
use reqwest::Client;
use serde_json::{json, Value};
use sqlx::SqlitePool;

pub const DEFAULT_BASE_URL: &str = "http://localhost:11434";
pub const DEFAULT_TARGET_LANG: &str = "简体中文";

async fn setting(pool: &SqlitePool, key: &str) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map(|v| v.filter(|s| !s.trim().is_empty()))
        .map_err(|e| e.to_string())
}

pub async fn load_config(pool: &SqlitePool) -> Result<LlmConfig, String> {
    Ok(LlmConfig {
        base_url: setting(pool, "llm_base_url")
            .await?
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string()),
        model: setting(pool, "llm_model").await?.unwrap_or_default(),
        target_lang: setting(pool, "llm_target_lang")
            .await?
            .unwrap_or_else(|| DEFAULT_TARGET_LANG.to_string()),
    })
}

fn endpoint(base_url: &str, path: &str) -> String {
    format!("{}{}", base_url.trim().trim_end_matches('/'), path)
}

pub async fn list_models(client: &Client, base_url: &str) -> Result<Vec<String>, String> {
    let response = client
        .get(endpoint(base_url, "/api/tags"))
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| format!("连接 Ollama 失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Ollama 返回 HTTP {}", response.status()));
    }
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    let mut models: Vec<String> = body["models"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|m| m["name"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    models.sort();
    Ok(models)
}

pub async fn chat(
    client: &Client,
    config: &LlmConfig,
    system: &str,
    user: &str,
) -> Result<String, String> {
    if config.model.trim().is_empty() {
        return Err("还没有选择 Ollama 模型，请先在设置里配置".to_string());
    }
    let mut body = json!({
        "model": config.model,
        "stream": false,
        "think": false,
        "keep_alive": "30m",
        "options": { "temperature": 0.2 },
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ]
    });

    let mut response = send_chat(client, config, &body).await?;
    // Older Ollama builds / non-thinking models may reject the `think` flag.
    if response.0 == 400 && response.1.to_lowercase().contains("think") {
        body.as_object_mut().map(|o| o.remove("think"));
        response = send_chat(client, config, &body).await?;
    }
    let (status, text) = response;
    if status >= 400 {
        return Err(format!("Ollama 返回 HTTP {status}: {}", text.chars().take(200).collect::<String>()));
    }
    let value: Value = serde_json::from_str(&text).map_err(|e| format!("无法解析 Ollama 响应: {e}"))?;
    let content = value["message"]["content"].as_str().unwrap_or("");
    Ok(strip_think(content).trim().to_string())
}

async fn send_chat(client: &Client, config: &LlmConfig, body: &Value) -> Result<(u16, String), String> {
    let response = client
        .post(endpoint(&config.base_url, "/api/chat"))
        .timeout(std::time::Duration::from_secs(180))
        .json(body)
        .send()
        .await
        .map_err(|e| format!("连接 Ollama 失败: {e}"))?;
    let status = response.status().as_u16();
    let text = response.text().await.map_err(|e| e.to_string())?;
    Ok((status, text))
}

/// Removes `<think>…</think>` blocks some reasoning models emit even when asked not to.
fn strip_think(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("<think>") {
        out.push_str(&rest[..start]);
        match rest[start..].find("</think>") {
            Some(end) => rest = &rest[start + end + "</think>".len()..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

pub fn translate_prompt(target_lang: &str) -> String {
    format!(
        "你是专业译者。把用户给出的文本翻译成{target_lang}。\
要求：忠实、通顺、符合中文技术写作习惯；专有名词、产品名、代码、公式保持原样；\
不要解释，不要加引号或前缀，只输出译文。如果原文已经是{target_lang}，原样输出。"
    )
}

pub const SUMMARY_PROMPT: &str = "你是阅读助手。用简体中文为这篇文章写一个摘要：\
先用 1-2 句话说明文章讲了什么，再列出 3-5 条要点（每条以「- 」开头）。\
只依据原文，不要编造，不要输出标题或其他客套话。";

/// FNV-1a 64-bit: stable across Rust versions, good enough for a cache key
/// (the stored source text is compared on read to rule out collisions).
pub fn cache_key(target_lang: &str, text: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in target_lang.bytes().chain([0u8]).chain(text.bytes()) {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}-{}", text.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_think_blocks() {
        assert_eq!(strip_think("<think>hmm</think>你好"), "你好");
        assert_eq!(strip_think("a<think>x</think>b<think>y</think>c"), "abc");
        assert_eq!(strip_think("plain"), "plain");
    }

    #[test]
    fn cache_key_depends_on_lang_and_text() {
        assert_eq!(cache_key("zh", "hello"), cache_key("zh", "hello"));
        assert_ne!(cache_key("zh", "hello"), cache_key("ja", "hello"));
        assert_ne!(cache_key("zh", "hello"), cache_key("zh", "hello!"));
    }
}
