use base64::Engine;
use reqwest::Client;

const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;

/// Whether the feed-provided body is too thin to read and we should pull the page.
pub fn needs_extraction(content: Option<&str>, summary: Option<&str>) -> bool {
    let visible_len = |html: &str| {
        let mut in_tag = false;
        html.chars()
            .filter(|c| {
                match c {
                    '<' => in_tag = true,
                    '>' => {
                        in_tag = false;
                        return false;
                    }
                    _ => {}
                }
                !in_tag && !c.is_whitespace()
            })
            .count()
    };
    let best = content.or(summary).map(visible_len).unwrap_or(0);
    best < 400
}

pub async fn extract_full_text(client: &Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let html = response.text().await.map_err(|e| format!("读取失败: {e}"))?;

    let url = url.to_string();
    let content = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let mut readability =
            dom_smoothie::Readability::new(html, Some(&url), Some(dom_smoothie::Config::default()))
                .map_err(|e| e.to_string())?;
        let article = readability.parse().map_err(|e| e.to_string())?;
        Ok(article.content.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(strip_control_chars(&content))
}

pub fn strip_control_chars(input: &str) -> String {
    input
        .chars()
        .filter(|ch| !ch.is_control() || matches!(ch, '\n' | '\r' | '\t'))
        .collect()
}

/// Downloads an image and returns it as a data: URI so archived articles are self-contained.
pub async fn fetch_image_data_uri(client: &Client, url: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "图片地址无效".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("只支持 http/https 图片".to_string());
    }
    let response = client
        .get(parsed)
        .header("Accept", "image/avif,image/webp,image/png,image/*;q=0.8")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").trim().to_string())
        .filter(|v| v.starts_with("image/"))
        .unwrap_or_else(|| "image/jpeg".to_string());
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("图片过大".to_string());
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

#[cfg(test)]
mod tests {
    use super::needs_extraction;

    #[test]
    fn short_summary_needs_extraction() {
        assert!(needs_extraction(None, Some("<p>Just a teaser</p>")));
        assert!(needs_extraction(None, None));
    }

    #[test]
    fn long_content_does_not() {
        let body = format!("<p>{}</p>", "word ".repeat(300));
        assert!(!needs_extraction(Some(&body), None));
    }
}
