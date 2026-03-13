use reqwest::Client;
use scraper::{Html, Selector};

pub struct ContentService;

impl ContentService {
    pub fn should_extract(url: &str, summary: Option<&str>) -> bool {
        if Self::is_tencent_developer_article(url) {
            return true;
        }

        match summary {
            None => true,
            Some(s) => s.len() < 500,
        }
    }

    pub async fn extract_full_text(url: &str) -> Result<String, ContentError> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .map_err(|e| ContentError::Request(e.to_string()))?;

        let html = client
            .get(url)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
            )
            .header(
                "Accept",
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            )
            .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
            .send()
            .await
            .map_err(|e| ContentError::Request(e.to_string()))?
            .text()
            .await
            .map_err(|e| ContentError::Request(e.to_string()))?;

        let url = url.to_string();
        let content = tokio::task::spawn_blocking(move || Self::extract_from_html(&url, &html))
            .await
            .map_err(|e| ContentError::Task(e.to_string()))??;

        Ok(content)
    }

    fn extract_from_html(url: &str, html: &str) -> Result<String, ContentError> {
        if let Some(content) = Self::extract_with_site_rules(url, html) {
            return Ok(content);
        }

        let cfg = dom_smoothie::Config::default();
        let mut readability =
            dom_smoothie::Readability::new(html.to_string(), Some(url), Some(cfg))
                .map_err(|e| ContentError::Parse(e.to_string()))?;

        let article = readability
            .parse()
            .map_err(|e| ContentError::Parse(e.to_string()))?;

        Ok(article.content.to_string())
    }

    fn extract_with_site_rules(url: &str, html: &str) -> Option<String> {
        if Self::is_tencent_developer_article(url) {
            return Self::extract_tencent_developer_article(html);
        }
        None
    }

    fn is_tencent_developer_article(url: &str) -> bool {
        let Ok(parsed) = reqwest::Url::parse(url) else {
            return false;
        };

        parsed.domain() == Some("cloud.tencent.com")
            && parsed.path().starts_with("/developer/article/")
    }

    fn extract_tencent_developer_article(html: &str) -> Option<String> {
        let document = Html::parse_document(html);
        let selectors = [
            ".mod-content",
            ".mod-article-content .mod-content",
            "article .mod-content",
        ];

        for selector_text in selectors {
            let selector = Selector::parse(selector_text).ok()?;
            let element = document.select(&selector).next()?;
            let inner = element.inner_html();
            let text_len = element.text().collect::<String>().trim().chars().count();
            if text_len >= 200 && !inner.trim().is_empty() {
                return Some(format!("<div>{}</div>", inner));
            }
        }

        None
    }
}

#[derive(Debug)]
pub enum ContentError {
    Request(String),
    Parse(String),
    Task(String),
}

impl std::fmt::Display for ContentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ContentError::Request(e) => write!(f, "Request error: {}", e),
            ContentError::Parse(e) => write!(f, "Parse error: {}", e),
            ContentError::Task(e) => write!(f, "Task error: {}", e),
        }
    }
}

impl std::error::Error for ContentError {}
