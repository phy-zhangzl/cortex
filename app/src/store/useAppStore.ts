import { create } from "zustand";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  api, errorMessage, type ArticleListItem, type Category, type Collection, type Feed, type Scope, type SyncReport,
} from "@/lib/api";
import { archiveArticle, inlineImages, loadBestContent } from "@/lib/archive";
import { cleanArticleHtml } from "@/lib/content";
import { articleToMarkdown, exportBaseName, safeFileName, type ExportFile } from "@/lib/markdown";
import { readPref, writePref } from "@/lib/prefs";

const PAGE_SIZE = 100;

export interface Toast {
  id: number;
  message: string;
  tone: "info" | "success" | "error";
}

/** Scopes that are collections you curate, not inboxes: never filter by unread. */
export const isCollection = (scope: Scope) =>
  scope.kind === "favorites" || scope.kind === "later" || scope.kind === "collection" || scope.kind === "unfiled";

/** All scopes that show favorites (all / unfiled / one collection). */
export const isFavoritesScope = (scope: Scope) =>
  scope.kind === "favorites" || scope.kind === "collection" || scope.kind === "unfiled";

interface AppState {
  categories: Category[];
  feeds: Feed[];
  collections: Collection[];
  counts: { unread: number; favorites: number; later: number };

  scope: Scope;
  unreadOnly: boolean;
  search: string;
  articles: ArticleListItem[];
  hasMore: boolean;
  listLoading: boolean;
  selectedId: string | null;

  syncing: boolean;
  lastSync: SyncReport | null;
  toasts: Toast[];

  refreshSidebar: () => Promise<void>;
  loadArticles: () => Promise<void>;
  loadMore: () => Promise<void>;
  setScope: (scope: Scope) => void;
  setUnreadOnly: (value: boolean) => void;
  setSearch: (value: string) => void;
  select: (id: string | null) => void;
  selectNeighbor: (delta: 1 | -1) => void;

  syncAll: (feedIds?: string[] | null) => Promise<void>;
  setRead: (id: string, isRead: boolean) => Promise<void>;
  markScopeRead: () => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  toggleReadLater: (id: string) => Promise<void>;
  /** Favorite (if needed) and file into a folder; `null` = unsorted favorites. */
  fileToCollection: (id: string, collectionId: string | null) => Promise<void>;
  exportMarkdown: (ids: string[] | "favorites") => Promise<void>;
  patchArticle: (id: string, patch: Partial<ArticleListItem>) => void;

  toast: (message: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
}

let listRequest = 0;
let toastSeq = 0;

export const useAppStore = create<AppState>((set, get) => ({
  categories: [],
  feeds: [],
  collections: [],
  counts: { unread: 0, favorites: 0, later: 0 },

  scope: { kind: "all" },
  unreadOnly: readPref("unread-only", true),
  search: "",
  articles: [],
  hasMore: false,
  listLoading: false,
  selectedId: null,

  syncing: false,
  lastSync: null,
  toasts: [],

  refreshSidebar: async () => {
    try {
      const [categories, feeds, counts, collections] = await Promise.all([
        api.listCategories(),
        api.listFeeds(),
        api.getCounts(),
        api.listCollections(),
      ]);
      set({ categories, feeds, counts, collections });
    } catch (error) {
      get().toast(`加载订阅失败：${errorMessage(error)}`, "error");
    }
  },

  loadArticles: async () => {
    const request = ++listRequest;
    const { scope, unreadOnly, search } = get();
    set({ listLoading: true });
    try {
      const items = await api.listArticles({
        scope,
        unreadOnly: unreadOnly && !isCollection(scope),
        search: search.trim() || null,
        limit: PAGE_SIZE,
        offset: 0,
      });
      if (request !== listRequest) return;
      set({ articles: items, hasMore: items.length === PAGE_SIZE, listLoading: false });
    } catch (error) {
      if (request !== listRequest) return;
      set({ listLoading: false });
      get().toast(`加载文章失败：${errorMessage(error)}`, "error");
    }
  },

  loadMore: async () => {
    const { scope, unreadOnly, search, articles, hasMore, listLoading } = get();
    if (!hasMore || listLoading) return;
    const request = ++listRequest;
    set({ listLoading: true });
    try {
      const items = await api.listArticles({
        scope,
        unreadOnly: unreadOnly && !isCollection(scope),
        search: search.trim() || null,
        limit: PAGE_SIZE,
        offset: articles.length,
      });
      if (request !== listRequest) return;
      const seen = new Set(articles.map((a) => a.id));
      set({
        articles: [...articles, ...items.filter((a) => !seen.has(a.id))],
        hasMore: items.length === PAGE_SIZE,
        listLoading: false,
      });
    } catch {
      set({ listLoading: false });
    }
  },

  setScope: (scope) => {
    set({ scope, selectedId: null });
    void get().loadArticles();
  },
  setUnreadOnly: (value) => {
    writePref("unread-only", value);
    set({ unreadOnly: value });
    void get().loadArticles();
  },
  setSearch: (value) => {
    set({ search: value });
    void get().loadArticles();
  },

  select: (id) => {
    set({ selectedId: id });
    const item = id ? get().articles.find((a) => a.id === id) : null;
    // Opening marks read; the item stays in the list until the next reload so j/k keep working.
    if (item && !item.is_read) void get().setRead(item.id, true);
  },

  selectNeighbor: (delta) => {
    const { articles, selectedId } = get();
    if (articles.length === 0) return;
    const index = selectedId ? articles.findIndex((a) => a.id === selectedId) : -1;
    const next = articles[Math.min(articles.length - 1, Math.max(0, index + delta))];
    if (next && next.id !== selectedId) get().select(next.id);
    if (delta === 1 && index >= articles.length - 5) void get().loadMore();
  },

  syncAll: async (feedIds = null) => {
    if (get().syncing) return;
    set({ syncing: true });
    try {
      const report = await api.syncFeeds(feedIds);
      set({ lastSync: report });
      await get().refreshSidebar();
      if (report.new_articles > 0 || get().articles.length === 0) await get().loadArticles();
      if (feedIds) {
        if (report.failures.length > 0) get().toast(`同步失败：${report.failures[0].error}`, "error");
        else get().toast(report.new_articles > 0 ? `新增 ${report.new_articles} 篇` : "没有新文章");
      }
    } catch (error) {
      get().toast(`同步失败：${errorMessage(error)}`, "error");
    } finally {
      set({ syncing: false });
    }
  },

  setRead: async (id, isRead) => {
    const item = get().articles.find((a) => a.id === id);
    get().patchArticle(id, { is_read: isRead });
    if (item && item.is_read !== isRead && item.feed_id) {
      const delta = isRead ? -1 : 1;
      set((s) => ({
        feeds: s.feeds.map((f) => (f.id === item.feed_id ? { ...f, unread_count: Math.max(0, f.unread_count + delta) } : f)),
        counts: { ...s.counts, unread: Math.max(0, s.counts.unread + delta) },
      }));
    }
    try {
      await api.setRead([id], isRead);
    } catch (error) {
      get().toast(errorMessage(error), "error");
      void get().refreshSidebar();
    }
  },

  markScopeRead: async () => {
    try {
      const changed = await api.markScopeRead(get().scope);
      get().toast(changed > 0 ? `已将 ${changed} 篇标为已读` : "没有未读文章");
      await Promise.all([get().refreshSidebar(), get().loadArticles()]);
    } catch (error) {
      get().toast(errorMessage(error), "error");
    }
  },

  toggleFavorite: async (id) => {
    const item = get().articles.find((a) => a.id === id);
    const article = item ?? (await api.getArticle(id).catch(() => null));
    if (!article) return;
    const next = !article.is_favorite;
    get().patchArticle(id, { is_favorite: next, is_archived: next ? (item?.is_archived ?? false) : false });
    set((s) => ({ counts: { ...s.counts, favorites: Math.max(0, s.counts.favorites + (next ? 1 : -1)) } }));
    try {
      await api.setFavorite(id, next);
      if (!next) {
        get().patchArticle(id, { collection_id: null });
        get().toast("已取消收藏");
        void get().refreshSidebar();
        if (get().scope.kind === "collection" || get().scope.kind === "unfiled") void get().loadArticles();
        return;
      }
      get().toast("已收藏，正在保存到本地…");
      const { images, failedImages } = await archiveArticle(id);
      get().patchArticle(id, { is_archived: true });
      get().toast(
        failedImages > 0 ? `已保存到本地（${images - failedImages}/${images} 张图片）` : "已完整保存到本地",
        "success",
      );
    } catch (error) {
      get().toast(`本地存档失败：${errorMessage(error)}`, "error");
    }
  },

  fileToCollection: async (id, collectionId) => {
    const item = get().articles.find((a) => a.id === id);
    const article = item ?? (await api.getArticle(id).catch(() => null));
    if (!article) return;
    const wasFavorite = article.is_favorite;
    get().patchArticle(id, { is_favorite: true, collection_id: collectionId });
    try {
      await api.setArticleCollection(id, collectionId);
      const name = get().collections.find((c) => c.id === collectionId)?.name;
      await get().refreshSidebar();
      if (get().scope.kind === "collection" || get().scope.kind === "unfiled") void get().loadArticles();
      if (wasFavorite) {
        get().toast(name ? `已移到「${name}」` : "已移出收藏夹", "success");
        return;
      }
      get().toast(name ? `已收藏到「${name}」，正在保存到本地…` : "已收藏，正在保存到本地…");
      const { images, failedImages } = await archiveArticle(id);
      get().patchArticle(id, { is_archived: true });
      get().toast(failedImages > 0 ? `已保存到本地（${images - failedImages}/${images} 张图片）` : "已完整保存到本地", "success");
    } catch (error) {
      get().toast(errorMessage(error), "error");
    }
  },

  toggleReadLater: async (id) => {
    const item = get().articles.find((a) => a.id === id);
    const article = item ?? (await api.getArticle(id).catch(() => null));
    if (!article) return;
    const next = !article.read_later;
    get().patchArticle(id, { read_later: next });
    set((s) => ({ counts: { ...s.counts, later: Math.max(0, s.counts.later + (next ? 1 : -1)) } }));
    try {
      await api.setReadLater(id, next);
      get().toast(next ? "已加入稍后读" : "已移出稍后读");
    } catch (error) {
      get().toast(errorMessage(error), "error");
    }
  },

  exportMarkdown: async (target) => {
    try {
      const all = target === "favorites";
      const ids = all
        ? (await api.listArticles({ scope: { kind: "favorites" }, unreadOnly: false, search: null, limit: 500, offset: 0 })).map((a) => a.id)
        : target;
      if (ids.length === 0) {
        get().toast("没有可导出的文章");
        return;
      }
      const folderNames = new Map(get().collections.map((c) => [c.id, safeFileName(c.name, 60)]));
      const files: ExportFile[] = [];
      const used = new Set<string>();
      let missingImages = 0;
      get().toast(ids.length > 1 ? `正在导出 ${ids.length} 篇（含图片）…` : "正在导出，下载图片中…");
      for (const id of ids) {
        let article = await api.getArticle(id);
        // Archived articles already carry their images; anything else gets them downloaded now.
        let html: string | undefined;
        if (!article.archived_html) {
          article = await loadBestContent(id);
          const cleaned = cleanArticleHtml(article.content || article.summary || "", article.url, article.title).html;
          const inlined = await inlineImages(cleaned, article.url);
          missingImages += inlined.failed;
          html = inlined.html;
        }
        const dir = all ? (article.collection_id ? folderNames.get(article.collection_id) ?? "" : "") : "";
        let base = exportBaseName(article);
        for (let n = 2; used.has(`${dir}/${base}`); n++) base = `${exportBaseName(article)} (${n})`;
        used.add(`${dir}/${base}`);
        files.push(...articleToMarkdown(article, base, dir, html));
      }
      const stamp = new Date().toISOString().slice(0, 10);
      const folder = ids.length === 1 && !all ? "Cortex 导出" : `Cortex 收藏 ${stamp}`;
      const path = await api.exportFiles(folder, files);
      get().toast(
        missingImages > 0 ? `已导出到「下载/${folder}」，${missingImages} 张图片下载失败` : `已导出到「下载/${folder}」`,
        missingImages > 0 ? "info" : "success",
      );
      const first = files.find((f) => f.path.endsWith(".md"));
      void revealItemInDir(first && ids.length === 1 ? `${path}/${first.path}` : path).catch(() => undefined);
    } catch (error) {
      get().toast(`导出失败：${errorMessage(error)}`, "error");
    }
  },

  patchArticle: (id, patch) => set((s) => ({ articles: s.articles.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),

  toast: (message, tone = "info") => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, tone }] }));
    window.setTimeout(() => get().dismissToast(id), tone === "error" ? 6000 : 3200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
