use crate::models::DiscoveredFeed;
use chrono::{DateTime, Utc};
use reqwest::Client;
use scraper::{Html, Selector};
use std::io::Cursor;

const FEED_ACCEPT: &str =
    "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, */*;q=0.8";

#[derive(Debug)]
pub struct ParsedFeed {
    pub title: Option<String>,
    pub site_url: Option<String>,
    pub entries: Vec<ParsedEntry>,
}

#[derive(Debug)]
pub struct ParsedEntry {
    pub title: String,
    pub url: String,
    pub author: Option<String>,
    pub pub_date: Option<DateTime<Utc>>,
    pub summary: Option<String>,
    pub content: Option<String>,
}

pub fn build_client() -> Client {
    Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Cortex/0.3")
        .build()
        .expect("failed to build HTTP client")
}

async fn get_bytes(client: &Client, url: &str) -> Result<(Vec<u8>, String), String> {
    let response = client
        .get(url)
        .header("Accept", FEED_ACCEPT)
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let final_url = response.url().to_string();
    let bytes = response.bytes().await.map_err(|e| format!("读取响应失败: {e}"))?;
    Ok((bytes.to_vec(), final_url))
}

pub fn parse_feed(bytes: &[u8], base_url: &str) -> Result<ParsedFeed, String> {
    let feed = feed_rs::parser::Builder::new()
        .base_uri(Some(base_url))
        .build()
        .parse(Cursor::new(bytes))
        .map_err(|e| format!("解析失败: {e}"))?;

    let site_url = feed
        .links
        .iter()
        .find(|l| l.rel.as_deref() != Some("self"))
        .map(|l| l.href.clone());

    Ok(ParsedFeed {
        title: feed.title.map(|t| t.content.trim().to_string()).filter(|t| !t.is_empty()),
        site_url,
        entries: feed.entries.into_iter().map(parse_entry).collect(),
    })
}

fn parse_entry(entry: feed_rs::model::Entry) -> ParsedEntry {
    // Prefer the article (alternate) link over enclosures / comments links.
    let url = entry
        .links
        .iter()
        .find(|l| l.rel.as_deref().map_or(true, |r| r == "alternate"))
        .or_else(|| entry.links.first())
        .map(|l| l.href.clone())
        .unwrap_or_default();

    ParsedEntry {
        title: entry
            .title
            .map(|t| t.content.trim().to_string())
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| "无标题".to_string()),
        url,
        author: entry.authors.first().map(|p| p.name.clone()),
        // Published first: "updated" would reshuffle old posts whenever they get edited.
        pub_date: entry.published.or(entry.updated),
        summary: entry.summary.map(|s| s.content),
        content: entry.content.and_then(|c| c.body).filter(|b| !b.trim().is_empty()),
    }
}

pub async fn fetch_feed(client: &Client, url: &str) -> Result<ParsedFeed, String> {
    let (bytes, final_url) = get_bytes(client, url).await?;
    parse_feed(&bytes, &final_url)
}

/// Accepts either a feed URL or a website URL and returns the feed it points to.
pub async fn discover(client: &Client, input: &str) -> Result<DiscoveredFeed, String> {
    let url = normalize_url(input)?;
    let (bytes, final_url) = get_bytes(client, &url).await?;

    if let Ok(parsed) = parse_feed(&bytes, &final_url) {
        return Ok(DiscoveredFeed {
            title: parsed.title.unwrap_or_else(|| host_of(&final_url)),
            url: final_url,
            site_url: parsed.site_url,
        });
    }

    let html = String::from_utf8_lossy(&bytes).to_string();
    let candidates = find_feed_links(&html, &final_url);
    for candidate in candidates.iter().chain(common_feed_paths(&final_url).iter()) {
        if let Ok((bytes, feed_url)) = get_bytes(client, candidate).await {
            if let Ok(parsed) = parse_feed(&bytes, &feed_url) {
                return Ok(DiscoveredFeed {
                    title: parsed.title.unwrap_or_else(|| host_of(&final_url)),
                    url: feed_url,
                    site_url: parsed.site_url.or(Some(final_url.clone())),
                });
            }
        }
    }

    Err("没有在这个地址找到 RSS/Atom 订阅".to_string())
}

fn normalize_url(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("请输入地址".to_string());
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let parsed = reqwest::Url::parse(&with_scheme).map_err(|_| "地址格式不正确".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("只支持 http/https 地址".to_string());
    }
    Ok(parsed.to_string())
}

fn host_of(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_else(|| url.to_string())
}

fn find_feed_links(html: &str, base: &str) -> Vec<String> {
    let document = Html::parse_document(html);
    let Ok(selector) = Selector::parse("link[rel~='alternate'][href]") else {
        return Vec::new();
    };
    let base = reqwest::Url::parse(base).ok();
    document
        .select(&selector)
        .filter(|el| {
            let t = el.value().attr("type").unwrap_or("").to_lowercase();
            t.contains("rss") || t.contains("atom") || t.contains("feed+json")
        })
        .filter_map(|el| el.value().attr("href"))
        .filter_map(|href| match &base {
            Some(b) => b.join(href).ok().map(|u| u.to_string()),
            None => Some(href.to_string()),
        })
        .collect()
}

fn common_feed_paths(base: &str) -> Vec<String> {
    let Ok(base) = reqwest::Url::parse(base) else {
        return Vec::new();
    };
    ["/feed", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml", "/rss"]
        .iter()
        .filter_map(|p| base.join(p).ok().map(|u| u.to_string()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rss_with_published_date_and_alternate_link() {
        let xml = r#"<?xml version="1.0"?>
<rss version="2.0"><channel><title>Blog</title><link>https://example.com</link>
<item><title>Hello</title><link>https://example.com/hello</link>
<pubDate>Mon, 02 Jan 2026 10:00:00 GMT</pubDate><description>Hi</description></item>
</channel></rss>"#;
        let feed = parse_feed(xml.as_bytes(), "https://example.com/feed").unwrap();
        assert_eq!(feed.title.as_deref(), Some("Blog"));
        assert_eq!(feed.entries.len(), 1);
        assert_eq!(feed.entries[0].url, "https://example.com/hello");
        assert!(feed.entries[0].pub_date.is_some());
    }

    #[test]
    fn finds_alternate_links_in_html() {
        let html = r#"<html><head>
<link rel="alternate" type="application/rss+xml" href="/feed.xml">
<link rel="stylesheet" href="/a.css">
</head></html>"#;
        let links = find_feed_links(html, "https://example.com/blog/");
        assert_eq!(links, vec!["https://example.com/feed.xml".to_string()]);
    }
}

#[cfg(test)]
mod network_tests {
    use super::*;

    /// Run manually: cargo test -- --ignored network
    #[tokio::test]
    #[ignore]
    async fn network_discover_and_fetch() {
        let client = build_client();
        let found = discover(&client, "https://blog.rust-lang.org/").await.expect("discover");
        assert!(found.url.contains("feed") || found.url.ends_with(".xml"), "{}", found.url);
        let feed = fetch_feed(&client, &found.url).await.expect("fetch");
        assert!(!feed.entries.is_empty());
        let first = &feed.entries[0];
        let text = crate::services::content_service::extract_full_text(&client, &first.url)
            .await
            .expect("extract");
        assert!(text.len() > 500);
        println!("{} -> {} entries; first: {} ({} chars)", found.url, feed.entries.len(), first.title, text.len());
    }
}
