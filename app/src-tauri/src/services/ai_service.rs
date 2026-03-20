use serde_json::{json, Value};
use sqlx::SqlitePool;

#[derive(Debug, Clone)]
pub struct AiConfig {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

impl AiConfig {
    pub fn is_configured(&self) -> bool {
        !self.base_url.trim().is_empty() && !self.api_key.trim().is_empty() && !self.model.trim().is_empty()
    }
}

async fn get_setting(pool: &SqlitePool, key: &str) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())
}

pub async fn load_config(pool: &SqlitePool) -> Result<AiConfig, String> {
    let provider = get_setting(pool, "ai_provider")
        .await?
        .or_else(|| std::env::var("AI_PROVIDER").ok())
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| {
            if std::env::var("DEEPSEEK_API_KEY").ok().filter(|v| !v.trim().is_empty()).is_some() {
                "deepseek".to_string()
            } else {
                "openai_compatible".to_string()
            }
        });
    let provider_key = provider.replace('-', "_");
    let provider_base_url_key = format!("ai_{}_base_url", provider_key);
    let provider_api_key_key = format!("ai_{}_api_key", provider_key);
    let provider_model_key = format!("ai_{}_model", provider_key);

    let base_url = get_setting(pool, &provider_base_url_key)
        .await?
        .or(get_setting(pool, "ai_base_url").await?)
        .or_else(|| std::env::var("AI_BASE_URL").ok())
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| match provider.as_str() {
            "deepseek" => "https://api.deepseek.com/v1".to_string(),
            _ => String::new(),
        });

    let legacy_deepseek_api_key = get_setting(pool, "deepseek_api_key").await?;
    let api_key = get_setting(pool, &provider_api_key_key)
        .await?
        .or(get_setting(pool, "ai_api_key").await?)
        .or(legacy_deepseek_api_key)
        .or_else(|| std::env::var("AI_API_KEY").ok())
        .or_else(|| std::env::var("DEEPSEEK_API_KEY").ok())
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_default();

    let model = get_setting(pool, &provider_model_key)
        .await?
        .or(get_setting(pool, "ai_model").await?)
        .or_else(|| std::env::var("AI_MODEL").ok())
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| match provider.as_str() {
            "deepseek" => "deepseek-chat".to_string(),
            "grok2api" => "grok-2".to_string(),
            _ => "grok-2".to_string(),
        });

    Ok(AiConfig {
        provider,
        base_url,
        api_key,
        model,
    })
}

pub async fn chat_json(
    pool: &SqlitePool,
    system_prompt: &str,
    user_prompt: &str,
    temperature: f64,
    max_tokens: u32,
) -> Result<Value, String> {
    let config = load_config(pool).await?;
    if !config.is_configured() {
        return Err("请先配置 AI Base URL / API Key / Model".to_string());
    }

    let endpoint = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let payload = json!({
        "model": config.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": false
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(endpoint)
        .bearer_auth(config.api_key)
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
    let json_text = if trimmed.starts_with('{') {
        trimmed.to_string()
    } else if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        trimmed[start..=end].to_string()
    } else {
        trimmed.to_string()
    };

    serde_json::from_str(&json_text)
        .map_err(|e| format!("AI 返回不是 JSON: {e} | raw={}", trimmed))
}
