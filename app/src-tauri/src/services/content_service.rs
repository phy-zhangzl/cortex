use crate::services::feed_service::ParsedEntry;

pub struct ContentService;

impl ContentService {
    /// Determine if full content extraction is needed based on summary length
    pub fn should_extract(summary: Option<&str>) -> bool {
        match summary {
            None => true,
            Some(s) => s.len() < 500,
        }
    }

    /// Extract full text content from a URL
    pub async fn extract_full_text(url: &str) -> Result<String, ContentError> {
        // Use spawn_blocking since dom_smoothie is synchronous
        let url = url.to_string();
        let content = tokio::task::spawn_blocking(move || Self::fetch_and_extract(&url))
            .await
            .map_err(|e| ContentError::Task(e.to_string()))??;

        Ok(content)
    }

    fn fetch_and_extract(url: &str) -> Result<String, ContentError> {
        // Use ureq for synchronous HTTP requests
        let response = ureq::get(url)
            .set("User-Agent", "Cortex/1.0 RSS Reader")
            .call()
            .map_err(|e| ContentError::Request(e.to_string()))?;

        let html = response
            .into_string()
            .map_err(|e| ContentError::Request(e.to_string()))?;

        // Use dom_smoothie to extract article content
        let cfg = dom_smoothie::Config::default();
        let mut readability =
            dom_smoothie::Readability::new(html.clone(), Some(url), Some(cfg))
                .map_err(|e| ContentError::Parse(e.to_string()))?;

        let article = readability
            .parse()
            .map_err(|e| ContentError::Parse(e.to_string()))?;

        Ok(article.content.to_string())
    }

    /// Smart extraction: extracts full text only if summary is too short
    pub async fn extract_if_needed(
        entry: &ParsedEntry,
    ) -> Result<Option<String>, ContentError> {
        if Self::should_extract(entry.summary.as_deref()) && !entry.url.is_empty() {
            match Self::extract_full_text(&entry.url).await {
                Ok(content) => Ok(Some(content)),
                Err(e) => {
                    eprintln!("Failed to extract content from {}: {}", entry.url, e);
                    Ok(None) // Graceful degradation
                }
            }
        } else {
            Ok(None)
        }
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
