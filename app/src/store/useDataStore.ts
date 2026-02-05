import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export interface Category {
  id: string;
  name: string;
  parent_id?: string | null;
  sort_order: number;
}

export interface Feed {
  id: string;
  title: string;
  url: string;
  site_url?: string | null;
  description?: string | null;
  category_id?: string | null;
  favicon_url?: string | null;
  is_active: boolean;
}

export interface Article {
  id: string;
  feed_id: string;
  title: string;
  url: string;
  author?: string | null;
  pub_date?: string | null;
  summary?: string | null;
  content?: string | null;
  content_extracted: boolean;
  is_read: boolean;
  is_favorite: boolean;
  read_progress: number;
}

interface DataState {
  categories: Category[];
  feeds: Feed[];
  articles: Article[];
  loading: boolean;
  error: string | null;
  loadAll: () => Promise<void>;
  createCategory: (name: string, parentId?: string | null) => Promise<Category | null>;
  updateCategoryName: (categoryId: string, name: string) => Promise<Category | null>;
  deleteCategory: (categoryId: string) => Promise<boolean>;
  createFeed: (payload: {
    title: string;
    url: string;
    siteUrl?: string | null;
    description?: string | null;
    categoryId?: string | null;
  }) => Promise<Feed | null>;
  updateFeed: (payload: {
    feedId: string;
    title: string;
    url: string;
    siteUrl?: string | null;
    description?: string | null;
    categoryId?: string | null;
  }) => Promise<Feed | null>;
  updateFeedFavicon: (feedId: string, faviconUrl: string | null) => Promise<Feed | null>;
  updateFeedCategory: (feedId: string, categoryId: string | null) => Promise<Feed | null>;
  fetchFeedArticles: (feedId: string) => Promise<number | null>;
  deleteFeed: (feedId: string) => Promise<boolean>;
  fetchArticleContent: (articleId: string) => Promise<Article | null>;
  updateArticleProgress: (articleId: string, progress: number, isRead: boolean) => Promise<void>;
  updateArticleFlags: (articleId: string, isRead: boolean, isFavorite: boolean) => Promise<void>;
}

export const useDataStore = create<DataState>((set, get) => ({
  categories: [],
  feeds: [],
  articles: [],
  loading: false,
  error: null,
  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      const [categories, feeds, articles] = await Promise.all([
        invoke<Category[]>("list_categories"),
        invoke<Feed[]>("list_feeds"),
        invoke<Article[]>("list_articles", { feedId: null, limit: 50 }),
      ]);
      set({ categories, feeds, articles, loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },
  createCategory: async (name, parentId) => {
    try {
      const category = await invoke<Category>("create_category", {
        name,
        parentId: parentId ?? null,
      });
      set({ categories: [...get().categories, category] });
      return category;
    } catch (error) {
      set({ error: String(error) });
      return null;
    }
  },
  updateCategoryName: async (categoryId, name) => {
    try {
      const category = await invoke<Category>("update_category_name", {
        categoryId,
        name,
      });
      set({
        categories: get().categories.map((item) =>
          item.id === categoryId ? category : item
        ),
      });
      return category;
    } catch (error) {
      set({ error: String(error) });
      return null;
    }
  },
  deleteCategory: async (categoryId) => {
    try {
      await invoke("delete_category", { categoryId });
      set({
        categories: get().categories.filter((item) => item.id !== categoryId),
        feeds: get().feeds.map((feed) =>
          feed.category_id === categoryId ? { ...feed, category_id: null } : feed
        ),
      });
      return true;
    } catch (error) {
      set({ error: String(error) });
      return false;
    }
  },
  createFeed: async ({ title, url, siteUrl, description, categoryId }) => {
    try {
      const feed = await invoke<Feed>("create_feed", {
        title,
        url,
        siteUrl: siteUrl ?? null,
        description: description ?? null,
        categoryId: categoryId ?? null,
      });
      set({ feeds: [feed, ...get().feeds] });
      return feed;
    } catch (error) {
      set({ error: String(error) });
      return null;
    }
  },
  updateFeed: async ({ feedId, title, url, siteUrl, description, categoryId }) => {
    try {
      const feed = await invoke<Feed>("update_feed", {
        feedId,
        title,
        url,
        siteUrl: siteUrl ?? null,
        description: description ?? null,
        categoryId: categoryId ?? null,
      });
      set({ feeds: get().feeds.map((item) => (item.id === feedId ? feed : item)) });
      return feed;
    } catch (error) {
      set({ error: String(error) });
      return null;
    }
  },
  updateFeedFavicon: async (feedId, faviconUrl) => {
    try {
      const feed = await invoke<Feed>("update_feed_favicon", {
        feedId,
        faviconUrl,
      });
      set({ feeds: get().feeds.map((item) => (item.id === feedId ? feed : item)) });
      return feed;
    } catch (error) {
      set({ error: String(error) });
      return null;
    }
  },
  updateFeedCategory: async (feedId, categoryId) => {
    try {
      const feed = await invoke<Feed>("update_feed_category", {
        feedId,
        categoryId,
      });
      set({
        feeds: get().feeds.map((item) => (item.id === feedId ? feed : item)),
      });
      return feed;
    } catch (error) {
      set({ error: String(error) });
      return null;
    }
  },
  fetchFeedArticles: async (feedId) => {
    try {
      const inserted = await invoke<number>("fetch_feed_articles", {
        feedId,
        limit: 30,
      });
      await get().loadAll();
      return inserted;
    } catch (error) {
      set({ error: String(error) });
      return null;
    }
  },
  deleteFeed: async (feedId) => {
    try {
      await invoke("delete_feed", { feedId });
      set({ feeds: get().feeds.filter((feed) => feed.id !== feedId) });
      set({ articles: get().articles.filter((article) => article.feed_id !== feedId) });
      return true;
    } catch (error) {
      set({ error: String(error) });
      return false;
    }
  },
  fetchArticleContent: async (articleId) => {
    try {
      const article = await invoke<Article>("fetch_article_content", {
        articleId,
      });
      set({
        articles: get().articles.map((item) =>
          item.id === articleId ? article : item
        ),
      });
      return article;
    } catch (error) {
      set({ error: String(error) });
      return null;
    }
  },
  updateArticleProgress: async (articleId, progress, isRead) => {
    try {
      await invoke("update_article_progress", {
        articleId,
        readProgress: progress,
        isRead,
      });
      set({
        articles: get().articles.map((item) =>
          item.id === articleId
            ? { ...item, read_progress: progress, is_read: isRead }
            : item
        ),
      });
    } catch (error) {
      set({ error: String(error) });
    }
  },
  updateArticleFlags: async (articleId, isRead, isFavorite) => {
    try {
      const article = await invoke<Article>("update_article_flags", {
        articleId,
        isRead,
        isFavorite,
      });
      set({
        articles: get().articles.map((item) =>
          item.id === articleId ? article : item
        ),
      });
    } catch (error) {
      set({ error: String(error) });
    }
  },
}));
