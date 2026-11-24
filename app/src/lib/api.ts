import { invoke } from "@tauri-apps/api/core";

export interface Category {
  id: string;
  name: string;
  sort_order: number;
}

export interface Feed {
  id: string;
  title: string;
  url: string;
  site_url: string | null;
  category_id: string | null;
  last_fetch_at: string | null;
  last_fetch_error: string | null;
  unread_count: number;
}

export interface ArticleListItem {
  id: string;
  feed_id: string | null;
  feed_title: string | null;
  title: string;
  url: string;
  author: string | null;
  pub_date: string | null;
  excerpt: string | null;
  is_read: boolean;
  is_favorite: boolean;
  read_later: boolean;
  is_archived: boolean;
}

export interface Article {
  id: string;
  feed_id: string | null;
  feed_title: string | null;
  title: string;
  url: string;
  author: string | null;
  pub_date: string | null;
  summary: string | null;
  content: string | null;
  content_extracted: boolean;
  archived_html: string | null;
  archived_at: string | null;
  ai_summary: string | null;
  is_read: boolean;
  is_favorite: boolean;
  read_later: boolean;
  read_progress: number;
}

export type Scope =
  | { kind: "all" }
  | { kind: "favorites" }
  | { kind: "later" }
  | { kind: "uncategorized" }
  | { kind: "category"; id: string }
  | { kind: "feed"; id: string };

export interface SyncReport {
  finished_at: string;
  feeds: number;
  new_articles: number;
  failures: Array<{ feed_id: string; title: string; error: string }>;
}

export interface FeedHealth {
  id: string;
  title: string;
  url: string;
  site_url: string | null;
  category_id: string | null;
  created_at: string | null;
  last_fetch_at: string | null;
  last_fetch_error: string | null;
  fetch_error_count: number;
  latest_entry_at: string | null;
  recent_count: number;
  unread_count: number;
  favorite_count: number;
}

export interface DiscoveredFeed {
  url: string;
  title: string;
  site_url: string | null;
}

export interface LlmConfig {
  base_url: string;
  model: string;
  target_lang: string;
}

export interface ImportItem {
  title: string;
  url: string;
  site_url: string | null;
  category: string | null;
}

export const api = {
  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),

  listCategories: () => invoke<Category[]>("list_categories"),
  createCategory: (name: string) => invoke<Category>("create_category", { name }),
  renameCategory: (categoryId: string, name: string) =>
    invoke<void>("rename_category", { categoryId, name }),
  deleteCategory: (categoryId: string) => invoke<void>("delete_category", { categoryId }),
  reorderCategories: (orderedIds: string[]) => invoke<void>("reorder_categories", { orderedIds }),

  listFeeds: () => invoke<Feed[]>("list_feeds"),
  discoverFeed: (url: string) => invoke<DiscoveredFeed>("discover_feed", { url }),
  createFeed: (p: { title: string; url: string; siteUrl: string | null; categoryId: string | null }) =>
    invoke<Feed>("create_feed", p),
  importFeeds: (items: ImportItem[]) =>
    invoke<{ added: number; skipped: number }>("import_feeds", { items }),
  updateFeed: (p: { feedId: string; title: string; url: string; categoryId: string | null }) =>
    invoke<Feed>("update_feed", p),
  moveFeed: (feedId: string, categoryId: string | null) => invoke<void>("move_feed", { feedId, categoryId }),
  deleteFeed: (feedId: string) => invoke<number>("delete_feed", { feedId }),
  syncFeeds: (feedIds: string[] | null) => invoke<SyncReport>("sync_feeds", { feedIds }),
  exportOpml: (content: string) => invoke<string>("export_opml", { content }),
  exportFiles: (folder: string, files: Array<{ path: string; text?: string; base64?: string }>) =>
    invoke<string>("export_files", { folder, files }),
  feedHealth: () => invoke<FeedHealth[]>("feed_health"),

  listArticles: (p: { scope: Scope; unreadOnly: boolean; search: string | null; limit: number; offset: number }) =>
    invoke<ArticleListItem[]>("list_articles", p),
  getCounts: () => invoke<{ unread: number; favorites: number; later: number }>("get_counts"),
  getArticle: (articleId: string) => invoke<Article>("get_article", { articleId }),
  loadFullContent: (articleId: string, force = false) =>
    invoke<Article>("load_full_content", { articleId, force }),
  setRead: (articleIds: string[], isRead: boolean) => invoke<void>("set_read", { articleIds, isRead }),
  markScopeRead: (scope: Scope) => invoke<number>("mark_scope_read", { scope }),
  setFavorite: (articleId: string, isFavorite: boolean) =>
    invoke<void>("set_favorite", { articleId, isFavorite }),
  setReadLater: (articleId: string, readLater: boolean) =>
    invoke<void>("set_read_later", { articleId, readLater }),
  updateProgress: (articleId: string, progress: number) =>
    invoke<void>("update_progress", { articleId, progress }),
  fetchImage: (url: string) => invoke<string>("fetch_image", { url }),
  saveArchive: (articleId: string, html: string) => invoke<void>("save_archive", { articleId, html }),

  getLlmConfig: () => invoke<LlmConfig>("get_llm_config"),
  listLlmModels: (baseUrl: string) => invoke<string[]>("list_llm_models", { baseUrl }),
  translateText: (text: string) => invoke<string>("translate_text", { text }),
  summarizeArticle: (articleId: string, text: string) =>
    invoke<string>("summarize_article", { articleId, text }),
};

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}
