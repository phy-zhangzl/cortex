use chrono::Utc;
use feed_rs::parser;
use reqwest::Client;
use std::io::Cursor;

pub struct FeedService {
    client: Client,
}

impl FeedService {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("Failed to create HTTP client"),
        }
    }

    pub async fn fetch_and_parse(&self, feed_url: &str) -> Result<ParsedFeed, FeedError> {
        let response = self
            .client
            .get(feed_url)
            .header("User-Agent", "Cortex/1.0 RSS Reader")
            .send()
            .await
            .map_err(FeedError::RequestError)?;

        let bytes = response.bytes().await.map_err(FeedError::RequestError)?;
        let feed = parser::parse(Cursor::new(bytes)).map_err(FeedError::ParseError)?;

        Ok(ParsedFeed {
            title: feed.title.map(|t| t.content).unwrap_or_default(),
            description: feed.description.map(|d| d.content).unwrap_or_default(),
            site_url: feed.links.first().map(|l| l.href.clone()).unwrap_or_default(),
            entries: feed.entries.into_iter().map(|e| self.parse_entry(e)).collect(),
        })
    }

    fn parse_entry(&self, entry: feed_rs::model::Entry) -> ParsedEntry {
        ParsedEntry {
            title: entry
                .title
                .map(|t| t.content)
                .unwrap_or_else(|| "无标题".to_string()),
            url: entry
                .links
                .first()
                .map(|l| l.href.clone())
                .unwrap_or_default(),
            author: entry.authors.first().map(|p| p.name.clone()),
            pub_date: entry.published.map(|d| d.to_utc()),
            summary: entry.summary.map(|s| s.content),
            content: entry.content.and_then(|c| c.body),
        }
    }
}

#[derive(Debug)]
pub struct ParsedFeed {
    pub title: String,
    pub description: String,
    pub site_url: String,
    pub entries: Vec<ParsedEntry>,
}

#[derive(Debug)]
pub struct ParsedEntry {
    pub title: String,
    pub url: String,
    pub author: Option<String>,
    pub pub_date: Option<chrono::DateTime<Utc>>,
    pub summary: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug)]
pub enum FeedError {
    RequestError(reqwest::Error),
    ParseError(feed_rs::parser::ParseFeedError),
}

impl std::fmt::Display for FeedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FeedError::RequestError(e) => write!(f, "Request error: {}", e),
            FeedError::ParseError(e) => write!(f, "Parse error: {}", e),
        }
    }
}

impl std::error::Error for FeedError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            FeedError::RequestError(e) => Some(e),
            FeedError::ParseError(e) => Some(e),
        }
    }
}
