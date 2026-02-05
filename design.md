# Project Cortex 设计方案

> 核心逻辑：**Rust 后端负责所有的脏活累活（抓取、清洗、解析、存储），前端只负责优雅地展示。**

---

## 1. 技术栈选型

| 模块 | 技术选型 | 说明 |
|------|---------|------|
| **应用框架** | Tauri v2 | 调用 macOS 原生 WebKit，比 Electron 轻 50 倍 |
| **后端语言** | Rust | 内存安全，并发处理能力强 |
| **前端框架** | React 18 + TypeScript | 组件化开发，生态丰富 |
| **状态管理** | Zustand | 轻量、TypeScript 友好 |
| **样式引擎** | Tailwind CSS | 原子化 CSS，快速构建响应式界面 |
| **UI 组件库** | Shadcn UI | 极简风格，支持深色模式 |
| **数据库** | SQLite + sqlx | 零配置本地存储，Tauri 官方支持 |
| **RSS 解析** | feed-rs | 支持 RSS 0.9/1.0/2.0, Atom, JSON Feed |
| **全文提取** | dom_smoothie | Mozilla readability.js Rust 移植 |
| **HTTP 客户端** | reqwest | Rust 标准异步 HTTP 客户端 |
| **构建工具** | Vite | 快速 HMR，优化打包 |

### 依赖版本确认（2025年2月）

```toml
# Cargo.toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["full"] }
feed-rs = "2"
dom_smoothie = "0.7"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
chrono = "0.4"
uuid = { version = "1", features = ["v4"] }
```

```json
// package.json
{
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-sql": "^2.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zustand": "^5.0.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.4.0",
    "vite": "^5.3.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0"
  }
}
```

---

## 2. 本地存储 vs 在线阅读

| 维度 | 在线阅读（无存储） | 本地存储（完整版） |
|------|-------------------|-------------------|
| **数据持久化** | 无，每次重启重新抓取 | SQLite 存储文章、阅读进度、收藏 |
| **离线能力** | 必须有网络 | 已抓取文章可离线阅读 |
| **性能体验** | 慢（每次都网络请求） | 快（本地查询毫秒级） |
| **功能扩展** | 仅限阅读 | 支持收藏、阅读历史、全文搜索、OPML 导入/导出 |
| **架构复杂度** | 简单（3层流水线） | 中等（需同步层、索引层） |

**决策**：采用本地存储方案。RSS 阅读器的核心价值在于**聚合管理**和**离线阅读**。

---

## 3. 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     Presentation Layer                          │
│  React + TypeScript + Tailwind CSS + Shadcn UI                 │
│  ├─ 订阅管理（分类、导入/导出）                                  │
│  ├─ 文章列表（筛选、排序、搜索）                                 │
│  ├─ 阅读器（主题、字体、进度）                                   │
│  └─ 设置（同步、快捷键、数据管理）                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Application Core                           │
│  Tauri v2 (Rust)                                                │
│  ├── Commands (IPC 接口层)                                       │
│  │   ├── feed_* (订阅源管理)                                    │
│  │   ├── article_* (文章CRUD)                                   │
│  │   ├── category_* (分类管理)                                  │
│  │   ├── fetch_feed (抓取RSS)                                   │
│  │   ├── extract_content (提取全文)                             │
│  │   └── opml_import/export                                     │
│  ├── Services (业务逻辑层)                                       │
│  │   ├── FeedService - RSS/Atom解析                             │
│  │   ├── ContentService - 智能全文提取                          │
│  │   └── SyncService - 增量更新、错误重试                       │
│  ├── Storage (数据访问层)                                        │
│  │   └── SQLite Repository - 文章/订阅源/分类/阅读进度          │
│  └── Models (领域模型)                                           │
│      ├── Feed, Article, Category                                │
│      └── 对应的数据库表结构                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. 数据模型设计

### 4.1 数据库表结构

```sql
-- 分类表（支持嵌套文件夹）
CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES categories(id),
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 订阅源表
CREATE TABLE feeds (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,          -- RSS URL
    site_url TEXT,                      -- 网站主页
    description TEXT,
    category_id TEXT REFERENCES categories(id),
    favicon_url TEXT,
    last_fetch_at DATETIME,
    last_fetch_error TEXT,
    fetch_error_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 文章表
CREATE TABLE articles (
    id TEXT PRIMARY KEY,
    feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    author TEXT,
    pub_date DATETIME,
    summary TEXT,                       -- RSS 摘要
    content TEXT,                       -- 提取的全文 (HTML)
    content_extracted BOOLEAN DEFAULT 0, -- 是否已提取全文
    is_read BOOLEAN DEFAULT 0,
    is_favorite BOOLEAN DEFAULT 0,
    read_progress REAL DEFAULT 0,       -- 阅读进度 0-100
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 全文搜索索引 (FTS5)
CREATE VIRTUAL TABLE articles_fts USING fts5(
    title,
    content,
    content_rowid=rowid
);

-- 索引优化
CREATE INDEX idx_articles_feed_id ON articles(feed_id);
CREATE INDEX idx_articles_pub_date ON articles(pub_date DESC);
CREATE INDEX idx_articles_is_read ON articles(is_read);
CREATE INDEX idx_articles_is_favorite ON articles(is_favorite);
```

### 4.2 Rust 模型定义

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Feed {
    pub id: String,
    pub title: String,
    pub url: String,
    pub site_url: String,
    pub description: String,
    pub category_id: Option<String>,
    pub favicon_url: Option<String>,
    pub last_fetch_at: Option<DateTime<Utc>>,
    pub last_fetch_error: Option<String>,
    pub fetch_error_count: i32,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Article {
    pub id: String,
    pub feed_id: String,
    pub title: String,
    pub url: String,
    pub author: Option<String>,
    pub pub_date: Option<DateTime<Utc>>,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub content_extracted: bool,
    pub is_read: bool,
    pub is_favorite: bool,
    pub read_progress: f64,
    pub fetched_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// IPC 传输用的简化模型
#[derive(Debug, Serialize, Deserialize)]
pub struct ArticleView {
    pub id: String,
    pub feed_id: String,
    pub feed_title: String,
    pub title: String,
    pub url: String,
    pub author: Option<String>,
    pub pub_date: String,
    pub summary: String,
    pub content: Option<String>,
    pub is_read: bool,
    pub is_favorite: bool,
}
```

---

## 5. 核心功能实现

### 5.1 RSS 抓取与解析

```rust
use feed_rs::parser;
use reqwest::Client;

pub struct FeedService {
    client: Client,
}

impl FeedService {
    pub async fn fetch_and_parse(&self, feed_url: &str) -> Result<ParsedFeed, FeedError> {
        // 1. 下载 RSS XML
        let response = self.client.get(feed_url)
            .timeout(Duration::from_secs(30))
            .send()
            .await?;
        
        let bytes = response.bytes().await?;
        
        // 2. 解析 RSS/Atom
        let feed = parser::parse(Cursor::new(bytes))?;
        
        // 3. 提取元数据
        Ok(ParsedFeed {
            title: feed.title.map(|t| t.content).unwrap_or_default(),
            description: feed.description.map(|d| d.content).unwrap_or_default(),
            site_url: feed.links.first().map(|l| l.href.clone()).unwrap_or_default(),
            entries: feed.entries.into_iter().map(|e| self.parse_entry(e)).collect(),
        })
    }
    
    fn parse_entry(&self, entry: Entry) -> ParsedEntry {
        ParsedEntry {
            title: entry.title.map(|t| t.content).unwrap_or("无标题".to_string()),
            url: entry.links.first().map(|l| l.href.clone()).unwrap_or_default(),
            author: entry.authors.first().map(|p| p.name.clone()),
            pub_date: entry.published,
            summary: entry.summary.map(|s| s.content),
            content: entry.content.and_then(|c| c.body),
        }
    }
}
```

### 5.2 智能全文提取

```rust
use dom_smoothie::{Config, Readability};
use tokio::task;

pub struct ContentService;

impl ContentService {
    /// 智能判断是否需要提取全文
    pub async fn extract_if_needed(&self, url: &str, summary: Option<&str>) -> Result<Option<String>, ContentError> {
        // 判断逻辑：如果摘要长度 < 500 字符，尝试提取全文
        let should_extract = summary.map(|s| s.len() < 500).unwrap_or(true);
        
        if !should_extract {
            return Ok(None);
        }
        
        // 异步网络请求 + 同步解析（dom_smoothie 是同步的）
        let url = url.to_string();
        let content = task::spawn_blocking(move || {
            Self::fetch_and_extract(&url)
        }).await??;
        
        Ok(Some(content))
    }
    
    fn fetch_and_extract(url: &str) -> Result<String, ContentError> {
        // 使用 ureq 进行同步 HTTP 请求（在 spawn_blocking 中）
        let html = ureq::get(url)
            .set("User-Agent", "Cortex/1.0 RSS Reader")
            .call()?
            .into_string()?;
        
        // 使用 dom_smoothie 提取正文
        let cfg = Config::default();
        let readability = Readability::new(&html, Some(url), Some(cfg))?;
        let article = readability.parse()?;
        
        Ok(article.content)
    }
}
```

### 5.3 OPML 导入/导出

```rust
use quick_xml::{events::Event, Reader, Writer};

pub struct OpmlService;

impl OpmlService {
    /// 解析 OPML 文件，返回 Feed 列表
    pub fn parse(opml_content: &str) -> Result<Vec<OpmlFeed>, OpmlError> {
        let mut reader = Reader::from_str(opml_content);
        reader.trim_text(true);
        
        let mut feeds = Vec::new();
        let mut buf = Vec::new();
        let mut current_category: Option<String> = None;
        
        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Start(e)) => {
                    match e.name().as_ref() {
                        b"outline" => {
                            let attrs = e.attributes();
                            let mut title = None;
                            let mut xml_url = None;
                            let mut html_url = None;
                            
                            for attr in attrs {
                                let attr = attr?;
                                match attr.key.as_ref() {
                                    b"text" | b"title" => title = Some(attr.value),
                                    b"xmlUrl" => xml_url = Some(attr.value),
                                    b"htmlUrl" => html_url = Some(attr.value),
                                    _ => {}
                                }
                            }
                            
                            // 如果 xmlUrl 存在，这是一个订阅源
                            if let Some(xml_url) = xml_url {
                                feeds.push(OpmlFeed {
                                    title: title.and_then(|t| String::from_utf8(t.to_vec()).ok()),
                                    xml_url: String::from_utf8(xml_url.to_vec())?,
                                    html_url: html_url.and_then(|h| String::from_utf8(h.to_vec()).ok()),
                                    category: current_category.clone(),
                                });
                            } else if title.is_some() && xml_url.is_none() {
                                // 这是一个分类/文件夹
                                current_category = title.and_then(|t| String::from_utf8(t.to_vec()).ok());
                            }
                        }
                        _ => {}
                    }
                }
                Ok(Event::End(e)) => {
                    if e.name().as_ref() == b"outline" && current_category.is_some() {
                        current_category = None;
                    }
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(OpmlError::XmlError(e)),
                _ => {}
            }
            buf.clear();
        }
        
        Ok(feeds)
    }
    
    /// 生成 OPML 文件
    pub fn generate(feeds: &[Feed], categories: &[Category]) -> Result<String, OpmlError> {
        // 按分类组织 feeds，生成 XML
        // ...
    }
}
```

---

## 6. 实施计划

### Phase 1: 基础架构 (2天)
- [ ] Tauri v2 + React + TypeScript 项目初始化
- [ ] Tailwind CSS + Shadcn UI 配置
- [ ] SQLite 数据库初始化（migrations）
- [ ] Capabilities 权限配置（网络、文件系统）
- [ ] 基础布局框架（三栏布局骨架）

### Phase 2: 数据层与存储 (2天)
- [ ] 数据库表创建（categories, feeds, articles）
- [ ] Rust Repository 层（CRUD 操作）
- [ ] Tauri Commands 封装
- [ ] 前端数据模型定义（Zustand store）
- [ ] 数据迁移工具

### Phase 3: 订阅源管理 (2天)
- [ ] 添加/编辑/删除订阅源
- [ ] 分类管理（创建、嵌套、拖拽排序）
- [ ] 左侧订阅源列表 UI
- [ ] OPML 导入/导出
- [ ] Favicon 获取与缓存

### Phase 4: 文章抓取与展示 (3天)
- [ ] RSS/Atom 抓取与解析（feed-rs）
- [ ] 文章列表展示（筛选、排序）
- [ ] 智能全文提取（dom_smoothie）
- [ ] 沉浸式阅读器（HTML 渲染、主题切换）
- [ ] 阅读进度追踪
- [ ] 增量同步逻辑（避免重复抓取）

### Phase 5: 高级功能 (2天)
- [ ] 收藏功能
- [ ] 已读/未读状态管理
- [ ] 全文搜索（FTS5）
- [ ] 快捷键支持
- [ ] 设置面板

### Phase 6: 优化与发布 (2天)
- [ ] 并发抓取优化（限制并发数、超时处理）
- [ ] 错误处理与重试机制
- [ ] 性能优化（虚拟滚动、懒加载）
- [ ] macOS 原生优化（标题栏、图标、签名）
- [ ] 打包与发布

---

## 7. Tauri Capabilities 配置

```json
// src-tauri/capabilities/default.json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:app:default",
    "core:event:default",
    "core:path:default",
    "core:window:default",
    "http:default",
    {
      "identifier": "http:allow-fetch",
      "allow": [{ "url": "https://*" }, { "url": "http://*" }]
    },
    "fs:default",
    "fs:allow-app-read-recursive",
    "fs:allow-app-write-recursive",
    "dialog:default",
    "sql:default",
    "sql:allow-load",
    "sql:allow-execute",
    "sql:allow-select"
  ]
}
```

---

## 8. 关键风险与应对

| 风险 | 影响 | 应对策略 |
|------|------|---------|
| **dom_smoothie 提取失败** | 中 | 降级显示 RSS 摘要 + 提供"在浏览器中打开"选项 |
| **网站反爬机制** | 中 | 支持自定义 User-Agent、请求间隔配置、礼貌爬取 |
| **大量文章导致性能下降** | 中 | 虚拟滚动、分页加载、归档旧文章策略 |
| **数据量过大** | 低 | 定期清理旧文章（保留1年）、数据库压缩 |
| **Tauri v2 API 变动** | 低 | 锁定依赖版本、关注官方迁移指南 |
| **网络不稳定** | 中 | 离线优先设计、失败重试、本地缓存 |

---

## 9. UI/UX 设计原则

1. **极简主义**：减少视觉干扰，专注阅读体验
2. **暗色优先**：默认深色主题，保护眼睛
3. **键盘优先**：支持完整的键盘导航和快捷键
4. **即时反馈**：操作后提供视觉/触觉反馈
5. **离线感知**：清晰的网络状态提示

### 布局结构
```
┌─────────────────────────────────────────────────────────────────┐
│  [Menu]  Cortex Reader                                    [Search]│
├──────────┬────────────────────────────┬─────────────────────────┤
│          │                            │                         │
│ 分类列表  │      文章列表               │      阅读器            │
│          │                            │                         │
│ - 技术    │  ☐ 文章标题 1              │  [标题]                 │
│   - RSS  │     摘要预览...            │  作者 | 日期            │
│ - 设计    │     2小时前                │                         │
│   - RSS  │                            │  [正文内容]             │
│          │  ☐ 文章标题 2              │                         │
│ [+] 添加 │     摘要预览...            │                         │
│          │     昨天                   │                         │
│          │                            │                         │
└──────────┴────────────────────────────┴─────────────────────────┘
   200px         350px                        剩余空间
```

---

## 10. 扩展性预留

- **全文搜索**：已设计 FTS5 索引
- **AI 摘要**：预留 API 接口，可接入 OpenAI/Claude
- **多端同步**：预留同步协议设计（可对接 iCloud/WebDAV）
- **插件系统**：Tauri 命令架构支持扩展

---

**文档版本**: v1.0  
**更新日期**: 2025-02-05  
**状态**: 已确认，准备实施
