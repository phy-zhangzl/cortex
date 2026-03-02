pub struct ContentService;

impl ContentService {
    pub fn should_extract(summary: Option<&str>) -> bool {
        match summary {
            None => true,
            Some(s) => s.len() < 500,
        }
    }

    pub async fn extract_full_text(url: &str) -> Result<String, ContentError> {
        let url = url.to_string();
        let content = tokio::task::spawn_blocking(move || Self::fetch_and_extract(&url))
            .await
            .map_err(|e| ContentError::Task(e.to_string()))??;

        Ok(content)
    }

    fn fetch_and_extract(url: &str) -> Result<String, ContentError> {
        let response = ureq::get(url)
            .set("User-Agent", "Cortex/1.0 RSS Reader")
            .call()
            .map_err(|e| ContentError::Request(e.to_string()))?;

        let html = response
            .into_string()
            .map_err(|e| ContentError::Request(e.to_string()))?;

        let cfg = dom_smoothie::Config::default();
        let mut readability =
            dom_smoothie::Readability::new(html.clone(), Some(url), Some(cfg))
                .map_err(|e| ContentError::Parse(e.to_string()))?;

        let article = readability
            .parse()
            .map_err(|e| ContentError::Parse(e.to_string()))?;

        Ok(article.content.to_string())
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
