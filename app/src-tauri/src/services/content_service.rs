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

/// Downloads an image and returns it as a data: URI so saved articles are self-contained.
///
/// Tries without a Referer first (some CDNs, e.g. WeChat, reject foreign referers), then
/// with the article page as Referer (hotlink-protected hosts require it).
pub async fn fetch_image_data_uri(client: &Client, url: &str, referer: Option<&str>) -> Result<String, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "图片地址无效".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("只支持 http/https 图片".to_string());
    }
    let first = try_fetch_image(client, &parsed, None).await;
    let (bytes, header_mime) = match (first, referer) {
        (Ok(ok), _) => ok,
        (Err(_), Some(referer)) => try_fetch_image(client, &parsed, Some(referer)).await?,
        (Err(e), None) => return Err(e),
    };
    let mime = sniff_image_mime(&bytes)
        .map(str::to_string)
        .or(header_mime)
        .ok_or_else(|| "不是图片".to_string())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

async fn try_fetch_image(
    client: &Client,
    url: &reqwest::Url,
    referer: Option<&str>,
) -> Result<(Vec<u8>, Option<String>), String> {
    let mut request = client
        .get(url.clone())
        .header("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
    if let Some(referer) = referer {
        request = request.header("Referer", referer);
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let header_mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").trim().to_lowercase())
        .filter(|v| v.starts_with("image/"));
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("图片过大".to_string());
    }
    if bytes.is_empty() {
        return Err("空响应".to_string());
    }
    // A hotlink-protected host often answers 200 with an HTML page instead of the image.
    let unsniffable = matches!(
        header_mime.as_deref(),
        Some("image/x-icon" | "image/vnd.microsoft.icon" | "image/tiff" | "image/heic" | "image/heif")
    );
    if sniff_image_mime(&bytes).is_none() && !unsniffable {
        return Err("返回的不是图片".to_string());
    }
    Ok((bytes.to_vec(), header_mime))
}

fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
    let starts = |sig: &[u8]| bytes.len() >= sig.len() && &bytes[..sig.len()] == sig;
    if starts(b"\x89PNG") {
        Some("image/png")
    } else if starts(b"\xFF\xD8\xFF") {
        Some("image/jpeg")
    } else if starts(b"GIF8") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" && (&bytes[8..12] == b"avif" || &bytes[8..12] == b"avis") {
        Some("image/avif")
    } else if starts(b"BM") {
        Some("image/bmp")
    } else {
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).to_lowercase();
        (head.contains("<svg") && !head.contains("<html")).then_some("image/svg+xml")
    }
}

#[cfg(test)]
mod tests {
    use super::{needs_extraction, sniff_image_mime};

    #[test]
    fn sniffs_common_image_types() {
        assert_eq!(sniff_image_mime(b"\x89PNG\r\n\x1a\n...."), Some("image/png"));
        assert_eq!(sniff_image_mime(b"\xFF\xD8\xFF\xE0...."), Some("image/jpeg"));
        assert_eq!(sniff_image_mime(b"RIFF\x00\x00\x00\x00WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff_image_mime(b"<?xml version=\"1.0\"?><svg xmlns=\"\">"), Some("image/svg+xml"));
        assert_eq!(sniff_image_mime(b"<!doctype html><html>forbidden</html>"), None);
    }

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
