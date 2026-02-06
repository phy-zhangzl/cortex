use crate::services::feed_service::ParsedEntry;
use chrono::{FixedOffset, NaiveDateTime, TimeZone, Utc};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{Map, Value};

pub struct WebSourceService {
    client: Client,
}

impl WebSourceService {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .connect_timeout(std::time::Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::limited(10))
                .gzip(true)
                .brotli(true)
                .deflate(true)
                .build()
                .expect("Failed to create HTTP client"),
        }
    }

    pub async fn fetch_qq_author_articles(
        &self,
        guest_suid: &str,
        tab_id: &str,
        limit: usize,
    ) -> Result<Vec<ParsedEntry>, WebSourceError> {
        let mut entries = Vec::new();
        let mut offset_info = "0".to_string();

        while entries.len() < limit {
            let page = self
                .client
                .get("https://i.news.qq.com/getSubNewsMixedList")
                .query(&[
                    ("guestSuid", guest_suid),
                    ("tabId", tab_id),
                    ("offset_info", offset_info.as_str()),
                    ("page_size", "20"),
                    ("apptype", "web"),
                ])
                .header("User-Agent", "Mozilla/5.0")
                .send()
                .await
                .map_err(|e| WebSourceError::Request(format!("request failed: {e}")))?
                .json::<QqMixedListResponse>()
                .await
                .map_err(|e| WebSourceError::Parse(format!("invalid response: {e}")))?;

            if page.ret != 0 {
                return Err(WebSourceError::Request(
                    page.errmsg
                        .or(page.info)
                        .unwrap_or_else(|| "qq api returned non-zero code".to_string()),
                ));
            }

            let newslist = page.newslist.unwrap_or_default();
            if newslist.is_empty() {
                break;
            }

            for item in newslist {
                if item.url.trim().is_empty() {
                    continue;
                }
                entries.push(ParsedEntry {
                    title: item.title,
                    url: item.url,
                    author: item.source,
                    pub_date: parse_qq_time(item.time.as_deref()),
                    summary: item.abstract_text.or(item.short_url),
                    content: None,
                });
                if entries.len() >= limit {
                    break;
                }
            }

            if page.has_next == Some(0) {
                break;
            }
            offset_info = page.offset_info.unwrap_or_else(|| "0".to_string());
            if offset_info == "0" {
                break;
            }
        }

        Ok(entries)
    }

    pub async fn fetch_generic_json(
        &self,
        config: &GenericJsonConfig,
        limit: usize,
    ) -> Result<Vec<ParsedEntry>, WebSourceError> {
        let mut entries = Vec::new();
        let method = config
            .method
            .as_deref()
            .unwrap_or("GET")
            .parse::<reqwest::Method>()
            .map_err(|e| WebSourceError::Parse(format!("invalid method: {e}")))?;
        let pagination_mode = config
            .pagination
            .as_ref()
            .and_then(|p| p.mode.as_deref())
            .unwrap_or("next_path");
        let mut next = config
            .pagination
            .as_ref()
            .and_then(|p| p.start.clone())
            .unwrap_or_default();
        let max_pages = config
            .pagination
            .as_ref()
            .and_then(|p| p.max_pages)
            .unwrap_or(10)
            .max(1) as usize;

        for _ in 0..max_pages {
            if entries.len() >= limit {
                break;
            }

            let mut req = self.client.request(method.clone(), &config.endpoint);
            for (key, value) in &config.query {
                let raw = json_value_to_string(value).unwrap_or_default();
                let resolved = resolve_template(&raw, &next);
                req = req.query(&[(key, &resolved)]);
            }
            if let Some(p) = &config.pagination {
                if let Some(param) = &p.next_param {
                    req = req.query(&[(param.as_str(), next.as_str())]);
                }
            }
            for (key, value) in &config.headers {
                let raw = json_value_to_string(value).unwrap_or_default();
                req = req.header(key, resolve_template(&raw, &next));
            }
            if let Some(body) = &config.body {
                let body = resolve_template_json(body, &next);
                req = req.json(&body);
            }

            let payload = req
                .send()
                .await
                .map_err(|e| WebSourceError::Request(format!("request failed: {e}")))?
                .json::<Value>()
                .await
                .map_err(|e| WebSourceError::Parse(format!("invalid response: {e}")))?;

            let items = get_value_by_path(&payload, &config.items_path)
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    WebSourceError::Parse(format!(
                        "items_path '{}' does not point to array",
                        config.items_path
                    ))
                })?;

            if items.is_empty() {
                break;
            }

            for item in items {
                let mut url = read_field(item, &config.fields.url).unwrap_or_default();
                if url.trim().is_empty() {
                    if let Some(template) = &config.fields.url_template {
                        url = render_field_template(template, item);
                    }
                }
                if url.trim().is_empty() {
                    continue;
                }
                let title = read_field(item, &config.fields.title)
                    .filter(|v| !v.trim().is_empty())
                    .unwrap_or_else(|| "无标题".to_string());
                let author = config
                    .fields
                    .author
                    .as_ref()
                    .and_then(|p| read_field(item, p));
                let summary = config
                    .fields
                    .summary
                    .as_ref()
                    .and_then(|p| read_field(item, p));
                let content = config
                    .fields
                    .content
                    .as_ref()
                    .and_then(|p| read_field(item, p));
                let pub_date = config
                    .fields
                    .pub_date
                    .as_ref()
                    .and_then(|p| read_field(item, p))
                    .and_then(|v| parse_datetime_any(&v));

                entries.push(ParsedEntry {
                    title,
                    url,
                    author,
                    pub_date,
                    summary,
                    content,
                });
                if entries.len() >= limit {
                    break;
                }
            }

            let Some(pagination) = &config.pagination else {
                break;
            };
            if pagination_mode == "page_number" {
                let current = next.parse::<i64>().unwrap_or(1);
                next = (current + 1).to_string();
                continue;
            }
            let Some(next_path) = &pagination.next_path else {
                break;
            };
            let next_value = get_value_by_path(&payload, next_path).and_then(json_value_to_string);
            let Some(next_value) = next_value else {
                break;
            };
            if next_value.is_empty() || next_value == next {
                break;
            }
            next = next_value;
        }

        Ok(entries)
    }
}

fn resolve_template(value: &str, next: &str) -> String {
    value.replace("{{next}}", next)
}

fn resolve_template_json(value: &Value, next: &str) -> Value {
    match value {
        Value::Null => Value::Null,
        Value::Bool(v) => Value::Bool(*v),
        Value::Number(v) => Value::Number(v.clone()),
        Value::String(v) => Value::String(resolve_template(v, next)),
        Value::Array(items) => {
            Value::Array(items.iter().map(|item| resolve_template_json(item, next)).collect())
        }
        Value::Object(obj) => {
            let mut out = Map::new();
            for (k, v) in obj {
                out.insert(k.clone(), resolve_template_json(v, next));
            }
            Value::Object(out)
        }
    }
}

fn get_value_by_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    if path.trim().is_empty() {
        return Some(value);
    }

    let mut current = value;
    for segment in path.split('.') {
        if segment.is_empty() {
            continue;
        }
        if let Ok(index) = segment.parse::<usize>() {
            current = current.as_array()?.get(index)?;
            continue;
        }
        current = current.as_object()?.get(segment)?;
    }
    Some(current)
}

fn read_field(value: &Value, path: &str) -> Option<String> {
    get_value_by_path(value, path).and_then(json_value_to_string)
}

fn render_field_template(template: &str, item: &Value) -> String {
    let mut output = template.to_string();
    let mut start = 0usize;
    while let Some(open_rel) = output[start..].find("{{") {
        let open = start + open_rel;
        let Some(close_rel) = output[open + 2..].find("}}") else {
            break;
        };
        let close = open + 2 + close_rel;
        let key = output[open + 2..close].trim();
        let replacement = read_field(item, key).unwrap_or_default();
        output.replace_range(open..close + 2, &replacement);
        start = open + replacement.len();
    }
    output
}

fn json_value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(v) => Some(v.to_string()),
        Value::Number(v) => Some(v.to_string()),
        Value::Bool(v) => Some(v.to_string()),
        _ => Some(value.to_string()),
    }
}

fn parse_qq_time(value: Option<&str>) -> Option<chrono::DateTime<Utc>> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    let naive = NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S").ok()?;
    let tz = FixedOffset::east_opt(8 * 3600)?;
    tz.from_local_datetime(&naive).single().map(|d| d.to_utc())
}

fn parse_datetime_any(value: &str) -> Option<chrono::DateTime<Utc>> {
    let text = value.trim();
    if text.is_empty() {
        return None;
    }
    if let Ok(ts) = text.parse::<i64>() {
        if ts > 10_000_000_000 {
            return chrono::DateTime::from_timestamp_millis(ts).map(|d| d.to_utc());
        }
        return chrono::DateTime::from_timestamp(ts, 0).map(|d| d.to_utc());
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(text) {
        return Some(dt.to_utc());
    }
    if let Ok(naive) = NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S") {
        let tz = FixedOffset::east_opt(8 * 3600)?;
        return tz.from_local_datetime(&naive).single().map(|d| d.to_utc());
    }
    None
}

#[derive(Debug, Deserialize)]
pub struct GenericJsonConfig {
    pub method: Option<String>,
    pub endpoint: String,
    #[serde(default)]
    pub query: Map<String, Value>,
    #[serde(default)]
    pub headers: Map<String, Value>,
    pub body: Option<Value>,
    pub items_path: String,
    pub fields: GenericFieldMap,
    pub pagination: Option<GenericPagination>,
}

#[derive(Debug, Deserialize)]
pub struct GenericFieldMap {
    pub title: String,
    pub url: String,
    pub url_template: Option<String>,
    pub author: Option<String>,
    pub pub_date: Option<String>,
    pub summary: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GenericPagination {
    pub mode: Option<String>,
    pub next_path: Option<String>,
    pub next_param: Option<String>,
    pub start: Option<String>,
    pub max_pages: Option<i64>,
}

impl GenericJsonConfig {
    pub fn normalize(&mut self) {
        if self
            .method
            .as_deref()
            .map(|v| v.trim().is_empty())
            .unwrap_or(true)
        {
            self.method = Some("GET".to_string());
        }
        if self.endpoint.trim().is_empty() {
            self.endpoint = String::new();
        }
        if self.items_path.trim().is_empty() {
            self.items_path = "data".to_string();
        }
    }
}

impl GenericPagination {
    pub fn normalize(&mut self) {
        if self
            .mode
            .as_deref()
            .map(|v| v.trim().is_empty())
            .unwrap_or(true)
        {
            self.mode = Some("next_path".to_string());
        }
        if self.mode.as_deref() == Some("page_number") && self.start.is_none() {
            self.start = Some("1".to_string());
        }
        if self.max_pages.unwrap_or(0) <= 0 {
            self.max_pages = Some(10);
        }
    }
}

fn normalize_map_values(map: &Map<String, Value>) -> Map<String, Value> {
    let mut output = Map::new();
    for (key, value) in map {
        if let Some(text) = json_value_to_string(value) {
            output.insert(key.to_string(), Value::String(text));
        }
    }
    output
}

impl GenericJsonConfig {
    pub fn normalized(mut self) -> Self {
        self.query = normalize_map_values(&self.query);
        self.headers = normalize_map_values(&self.headers);
        self.normalize();
        if let Some(p) = self.pagination.as_mut() {
            p.normalize();
        }
        self
    }
}

#[derive(Debug, Deserialize)]
struct QqMixedListResponse {
    ret: i32,
    errmsg: Option<String>,
    info: Option<String>,
    #[serde(default)]
    newslist: Option<Vec<QqNewsItem>>,
    #[serde(rename = "hasNext")]
    has_next: Option<i32>,
    #[serde(rename = "offsetInfo")]
    offset_info: Option<String>,
}

#[derive(Debug, Deserialize)]
struct QqNewsItem {
    title: String,
    url: String,
    time: Option<String>,
    source: Option<String>,
    #[serde(rename = "abstract")]
    abstract_text: Option<String>,
    short_url: Option<String>,
}

#[derive(Debug)]
pub enum WebSourceError {
    Request(String),
    Parse(String),
}

impl std::fmt::Display for WebSourceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WebSourceError::Request(e) => write!(f, "Request error: {e}"),
            WebSourceError::Parse(e) => write!(f, "Parse error: {e}"),
        }
    }
}

impl std::error::Error for WebSourceError {}
