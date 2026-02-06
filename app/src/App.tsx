import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@/components/ui/button";
import { useDataStore } from "@/store/useDataStore";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";
import parse from "html-react-parser";

// Types for our data structures
type Article = ReturnType<typeof useDataStore.getState>["articles"][number];

function App() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedFeed, setSelectedFeed] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedStatus, setSeedStatus] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [feedTitle, setFeedTitle] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedSourceType, setFeedSourceType] = useState<"rss" | "web_api">("rss");
  const [feedSourceConfig, setFeedSourceConfig] = useState("");
  const [feedSiteUrl, setFeedSiteUrl] = useState("");
  const [feedCategoryId, setFeedCategoryId] = useState<string | null>(null);
  const [editingFeedId, setEditingFeedId] = useState<string | null>(null);
  const [confirmDeleteFeedId, setConfirmDeleteFeedId] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [allFeedsCollapsed, setAllFeedsCollapsed] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      return localStorage.getItem("cortex:all-feeds-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [readerFontSize, setReaderFontSize] = useState(() => {
    if (typeof window === "undefined") {
      return 18;
    }
    try {
      const stored = Number(localStorage.getItem("cortex:reader-font-size"));
      return Number.isFinite(stored) && stored > 0 ? stored : 18;
    } catch {
      return 18;
    }
  });
  const [selectedFeedCategoryId, setSelectedFeedCategoryId] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<"all" | "unread" | "favorites">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<"newest" | "oldest" | "title" | "unread" | "score">("newest");
  const [articleLimit, setArticleLimit] = useState(50);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const autoSyncRunningRef = useRef(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentHtml, setContentHtml] = useState<string>("");
  const [contentError, setContentError] = useState<string | null>(null);
  const [contentSource, setContentSource] = useState<"full" | "summary" | null>(null);
  const [readProgress, setReadProgress] = useState(0);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [tocItems, setTocItems] = useState<Array<{ id: string; text: string; level: number }>>(
    []
  );
  const [activeTocId, setActiveTocId] = useState<string | null>(null);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const lastSavedProgressRef = useRef(0);

  const {
    categories,
    feeds,
    articles,
    loading,
    error,
    loadAll,
    createCategory,
    deleteCategory,
    createFeed,
    updateFeed,
    updateFeedFavicon,
    updateFeedCategory,
    fetchFeedArticles,
    deleteFeed,
    fetchArticleContent,
    analyzeArticle,
    updateArticleProgress,
    updateArticleFlags,
  } = useDataStore();

  const appWindow = getCurrentWindow();

  const handleDragPointerDown = async (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as Element | null;
    if (!target || typeof (target as Element).closest !== "function") {
      return;
    }

    if (
      target.closest(
        "button, a, input, textarea, select, option, .no-drag, [data-tauri-drag-region='false']"
      )
    ) {
      return;
    }

    try {
      await appWindow.startDragging();
    } catch (error) {
      console.error("startDragging failed", error);
    }
  };

  // Toggle dark mode
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "cortex:all-feeds-collapsed",
        allFeedsCollapsed ? "true" : "false"
      );
    } catch {
      // ignore
    }
  }, [allFeedsCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem("cortex:reader-font-size", String(readerFontSize));
    } catch {
      // ignore
    }
  }, [readerFontSize]);

  const reloadAll = useCallback(
    async (limitOverride?: number) => {
      await loadAll(limitOverride ?? articleLimit);
    },
    [articleLimit, loadAll]
  );

  useEffect(() => {
    reloadAll();
  }, [reloadAll]);

  useEffect(() => {
    if (!selectedFeed) {
      setSelectedFeedCategoryId(null);
      return;
    }
    const feed = feeds.find((item) => item.id === selectedFeed);
    setSelectedFeedCategoryId(feed?.category_id ?? null);
  }, [feeds, selectedFeed]);

  const unreadCounts = useMemo(() => {
    const counts = new Map<string, number>();
    articles.forEach((article) => {
      if (!article.is_read) {
        counts.set(article.feed_id, (counts.get(article.feed_id) || 0) + 1);
      }
    });
    return counts;
  }, [articles]);

  const totalUnread = useMemo(() => {
    return articles.filter((article) => !article.is_read).length;
  }, [articles]);

  const selectedFeedInfo = useMemo(() => {
    if (!selectedFeed) {
      return null;
    }
    return feeds.find((feed) => feed.id === selectedFeed) ?? null;
  }, [feeds, selectedFeed]);

  const arxivFeed = useMemo(() => {
    return (
      feeds.find((feed) =>
        feed.url.toLowerCase().includes("export.arxiv.org/rss/cs.ai")
      ) || null
    );
  }, [feeds]);

  const selectedFeedTitle = useMemo(() => {
    if (!selectedArticle) {
      return null;
    }
    return feeds.find((feed) => feed.id === selectedArticle.feed_id)?.title || null;
  }, [feeds, selectedArticle]);

  const articleTimestamp = useCallback((article: Article) => {
    if (!article.pub_date) {
      return 0;
    }
    const time = new Date(article.pub_date).getTime();
    return Number.isNaN(time) ? 0 : time;
  }, []);

  const estimateReadMinutes = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return 1;
    }
    const hasSpaces = /\s/.test(trimmed);
    const count = hasSpaces ? trimmed.split(/\s+/).length : trimmed.length;
    const wordsPerMinute = hasSpaces ? 200 : 350;
    return Math.max(1, Math.round(count / wordsPerMinute));
  }, []);

  const filteredArticles = useMemo(() => {
    let list = articles;
    if (selectedFeed) {
      list = list.filter((article) => article.feed_id === selectedFeed);
    } else if (selectedCategory) {
      const feedIds = feeds
        .filter((feed) => feed.category_id === selectedCategory)
        .map((feed) => feed.id);
      list = list.filter((article) => feedIds.includes(article.feed_id));
    }

    if (filterMode === "unread") {
      list = list.filter((article) => !article.is_read);
    } else if (filterMode === "favorites") {
      list = list.filter((article) => article.is_favorite);
    }

    const keyword = searchQuery.trim().toLowerCase();
    if (keyword) {
      list = list.filter((article) => {
        const title = article.title?.toLowerCase() || "";
        const summary = article.summary?.toLowerCase() || "";
        const author = article.author?.toLowerCase() || "";
        return (
          title.includes(keyword) ||
          summary.includes(keyword) ||
          author.includes(keyword)
        );
      });
    }

    const sorted = [...list];
    if (sortMode === "oldest") {
      sorted.sort((a, b) => articleTimestamp(a) - articleTimestamp(b));
    } else if (sortMode === "title") {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortMode === "score") {
      sorted.sort((a, b) => {
        const scoreA = a.ai_score ?? -1;
        const scoreB = b.ai_score ?? -1;
        if (scoreA === scoreB) {
          return articleTimestamp(b) - articleTimestamp(a);
        }
        return scoreB - scoreA;
      });
    } else if (sortMode === "unread") {
      sorted.sort((a, b) => {
        if (a.is_read === b.is_read) {
          return articleTimestamp(b) - articleTimestamp(a);
        }
        return a.is_read ? 1 : -1;
      });
    } else {
      sorted.sort((a, b) => articleTimestamp(b) - articleTimestamp(a));
    }

    return sorted;
  }, [
    articles,
    articleTimestamp,
    feeds,
    filterMode,
    searchQuery,
    selectedCategory,
    selectedFeed,
    sortMode,
  ]);

  const visibleArticles = filteredArticles;

  const readMinutes = useMemo(() => {
    if (!selectedArticle) {
      return null;
    }
    const source = contentHtml || "";
    const plain = source.replace(/<[^>]*>/g, " ");
    const trimmed = plain.trim();
    if (!trimmed) {
      return null;
    }
    return estimateReadMinutes(trimmed);
  }, [contentHtml, estimateReadMinutes, selectedArticle]);

  const handleLoadMore = () => {
    const next = articleLimit + 50;
    setArticleLimit(next);
    reloadAll(next);
  };

  const formatDateTime = useCallback((value?: string | null) => {
    if (!value) {
      return "未同步";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "未同步";
    }
    return date.toLocaleString();
  }, []);

  const handleAddSampleData = async () => {
    try {
      setSeedLoading(true);
      setSeedStatus("正在写入数据库...");
      const existingCategory = categories[0];
      const category =
        existingCategory || (await createCategory("技术", null));

      if (!category) {
        setSeedStatus(useDataStore.getState().error || "写入分类失败");
        setSeedLoading(false);
        return;
      }

      const feed = await createFeed({
        title: "OpenAI Blog",
        url: "https://openai.com/blog/rss.xml",
        siteUrl: "https://openai.com/blog",
        description: "OpenAI 官方博客",
        categoryId: category.id,
      });

      if (!feed) {
        setSeedStatus(useDataStore.getState().error || "写入订阅源失败");
        return;
      }

      await reloadAll();
      setSeedStatus("写入完成");
    } catch (error) {
      console.error("Seed data failed", error);
      setSeedStatus(`失败: ${String(error)}`);
    } finally {
      setSeedLoading(false);
    }
  };

  const handleAddQqAuthorSample = async () => {
    try {
      setSeedLoading(true);
      setSeedStatus("正在添加腾讯作者源...");

      const existingCategory = categories[0];
      const category = existingCategory || (await createCategory("未分类", null));
      if (!category) {
        setSeedStatus(useDataStore.getState().error || "写入分类失败");
        return;
      }

      const feed = await createFeed({
        title: "阿里技术（腾讯作者）",
        url: "https://news.qq.com/omn/author/8QMf13xV64IUuQ%3D%3D",
        description: "腾讯新闻作者页（Web API）",
        categoryId: category.id,
      });

      if (!feed) {
        setSeedStatus(useDataStore.getState().error || "写入订阅源失败");
        return;
      }

      await reloadAll();
      setSeedStatus("腾讯作者源已添加，可直接抓取测试");
    } catch (error) {
      console.error("Add QQ source failed", error);
      setSeedStatus(`失败: ${String(error)}`);
    } finally {
      setSeedLoading(false);
    }
  };

  const resetFeedForm = () => {
    setFeedTitle("");
    setFeedUrl("");
    setFeedSourceType("rss");
    setFeedSourceConfig("");
    setFeedSiteUrl("");
    setFeedCategoryId(null);
    setEditingFeedId(null);
  };

  const openCreateFeedForm = () => {
    resetFeedForm();
    setSeedStatus(null);
    setShowAddForm(true);
  };

  const closeFeedForm = () => {
    setShowAddForm(false);
    resetFeedForm();
  };

  const handleToggleAddForm = () => {
    if (showAddForm) {
      closeFeedForm();
      return;
    }
    openCreateFeedForm();
  };

  const handleStartEditFeed = (feed: (typeof feeds)[number]) => {
    setShowAddForm(true);
    setEditingFeedId(feed.id);
    setFeedTitle(feed.title);
    setFeedUrl(feed.url);
    setFeedSourceType(feed.source_type === "web_api" ? "web_api" : "rss");
    setFeedSourceConfig(feed.source_config ?? "");
    setFeedSiteUrl(feed.site_url ?? "");
    setFeedCategoryId(feed.category_id ?? null);
    setSeedStatus(null);
    setConfirmDeleteFeedId(null);
  };

  const handleRequestDeleteFeed = (feedId: string) => {
    setConfirmDeleteFeedId(feedId);
  };

  const handleSaveFeed = async () => {
    if (!feedTitle.trim() || !feedUrl.trim()) {
      setSeedStatus("请填写标题和源地址");
      return;
    }

    const urlText = feedUrl.trim();
    if (urlText.startsWith("<")) {
      setSeedStatus("源地址需要填写 URL，不是 XML 内容");
      return;
    }

    try {
      const parsedUrl = new URL(urlText);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        setSeedStatus("源地址必须是 http/https URL");
        return;
      }
    } catch {
      setSeedStatus("请填写有效 URL，例如 https://baoyu.io/feed.xml");
      return;
    }

    const normalizedSourceConfig = feedSourceConfig.trim();
    const isQqAuthorUrl = (() => {
      try {
        const parsed = new URL(urlText);
        return parsed.hostname === "news.qq.com" && parsed.pathname.startsWith("/omn/author/");
      } catch {
        return false;
      }
    })();
    if (feedSourceType === "web_api" && !normalizedSourceConfig && !isQqAuthorUrl) {
      setSeedStatus("Web API 源请填写 JSON 配置（腾讯作者页可留空）");
      return;
    }
    if (feedSourceType === "web_api" && normalizedSourceConfig) {
      try {
        JSON.parse(normalizedSourceConfig);
      } catch {
        setSeedStatus("Web API 配置必须是合法 JSON");
        return;
      }
    }

    try {
      setSeedLoading(true);
      setSeedStatus(editingFeedId ? "正在更新订阅源..." : "正在保存订阅源...");

      const existingCategory = categories[0];
      const category =
        existingCategory || (await createCategory("未分类", null));

      if (!category) {
        setSeedStatus(useDataStore.getState().error || "写入分类失败");
        return;
      }

      const feed = editingFeedId
        ? await updateFeed({
            feedId: editingFeedId,
            title: feedTitle.trim(),
            url: urlText,
            sourceType: feedSourceType,
            sourceConfig: normalizedSourceConfig || null,
            siteUrl: feedSiteUrl.trim() || null,
            description: null,
            categoryId: feedCategoryId ?? category.id,
          })
        : await createFeed({
            title: feedTitle.trim(),
            url: urlText,
            sourceType: feedSourceType,
            sourceConfig: normalizedSourceConfig || null,
            siteUrl: feedSiteUrl.trim() || null,
            description: null,
            categoryId: feedCategoryId ?? category.id,
          });

      if (!feed) {
        setSeedStatus(
          useDataStore.getState().error ||
            (editingFeedId ? "更新订阅源失败" : "写入订阅源失败")
        );
        return;
      }

      await reloadAll();
      setSeedStatus(editingFeedId ? "订阅源已更新" : "订阅源已保存");
      closeFeedForm();
    } catch (error) {
      console.error("Save feed failed", error);
      setSeedStatus(`失败: ${String(error)}`);
    } finally {
      setSeedLoading(false);
    }
  };

  const handleDetectSourceConfig = async () => {
    const urlText = feedUrl.trim();
    if (!urlText) {
      setSeedStatus("请先填写源地址 URL");
      return;
    }
    try {
      const result = await invoke<{ sourceType?: string; sourceConfig?: unknown }>(
        "suggest_source_config",
        { url: urlText }
      );
      const sourceType = result?.sourceType === "web_api" ? "web_api" : "rss";
      setFeedSourceType(sourceType);
      if (result?.sourceConfig && result.sourceConfig !== null) {
        setFeedSourceConfig(JSON.stringify(result.sourceConfig, null, 2));
        setSeedStatus("已自动生成 Web API 配置");
      } else {
        setFeedSourceConfig("");
        setSeedStatus("未识别到特殊站点，按 RSS/Atom 处理");
      }
    } catch (error) {
      setSeedStatus(`自动识别失败: ${String(error)}`);
    }
  };

  const handleSyncFeed = async () => {
    if (!selectedFeed) {
      setSyncStatus("请选择一个订阅源");
      return;
    }

    try {
      setSyncLoading(true);
      setSyncStatus("正在抓取内容源...");
      const inserted = await fetchFeedArticles(selectedFeed, {
        refreshLimit: articleLimit,
      });
      if (inserted === null) {
        setSyncStatus(useDataStore.getState().error || "抓取失败");
        return;
      }
      setSyncStatus(`新增 ${inserted} 篇文章`);
    } catch (error) {
      setSyncStatus(`失败: ${String(error)}`);
    } finally {
      setSyncLoading(false);
    }
  };

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) {
      setSeedStatus("请输入分类名称");
      return;
    }
    const category = await createCategory(name, null);
    if (!category) {
      setSeedStatus(useDataStore.getState().error || "创建分类失败");
      return;
    }
    setNewCategoryName("");
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (!confirm("确定要删除该分类吗？分类下订阅会移到未分类。")) {
      return;
    }
    const ok = await deleteCategory(categoryId);
    if (!ok) {
      setSeedStatus(useDataStore.getState().error || "删除分类失败");
    }
  };

  const handleUpdateSelectedFeedCategory = async () => {
    if (!selectedFeed) {
      return;
    }
    await updateFeedCategory(selectedFeed, selectedFeedCategoryId);
  };

  const handleAutoSyncAll = useCallback(async () => {
    if (autoSyncRunningRef.current || feeds.length === 0) {
      return;
    }

    autoSyncRunningRef.current = true;
    let totalInserted = 0;

    try {
      for (const feed of feeds) {
        const inserted = await fetchFeedArticles(feed.id, {
          refreshLimit: articleLimit,
        });
        if (typeof inserted === "number") {
          totalInserted += inserted;
        }
      }
      if (autoSyncEnabled) {
        setSyncStatus(`自动同步完成，新增 ${totalInserted} 篇文章`);
      }
    } catch (error) {
      if (autoSyncEnabled) {
        setSyncStatus(`自动同步失败: ${String(error)}`);
      }
    } finally {
      autoSyncRunningRef.current = false;
    }
  }, [articleLimit, autoSyncEnabled, feeds, fetchFeedArticles]);

  const runArxivGatekeeper = useCallback(async () => {
    if (!arxivFeed) {
      return;
    }

    const today = new Date().toLocaleDateString("en-CA");
    const lastRun = (() => {
      try {
        return localStorage.getItem("cortex:arxiv-gatekeeper-date");
      } catch {
        return null;
      }
    })();

    if (lastRun === today) {
      return;
    }

    setSyncStatus("守门员正在筛选 arXiv cs.AI...");
    const inserted = await fetchFeedArticles(arxivFeed.id, {
      fetchLimit: 200,
      refreshLimit: articleLimit,
    });
    if (inserted === null) {
      setSyncStatus(useDataStore.getState().error || "守门员抓取失败");
      return;
    }

    try {
      localStorage.setItem("cortex:arxiv-gatekeeper-date", today);
    } catch {
      // ignore
    }
    setSyncStatus(`守门员完成，新增 ${inserted} 篇文章`);
  }, [arxivFeed, articleLimit, fetchFeedArticles]);

  useEffect(() => {
    if (!arxivFeed) {
      return;
    }

    const scheduleNext = () => {
      const now = new Date();
      const next = new Date();
      next.setHours(8, 0, 0, 0);
      if (now >= next) {
        next.setDate(next.getDate() + 1);
      }
      const delay = next.getTime() - now.getTime();
      return window.setTimeout(async () => {
        await runArxivGatekeeper();
        scheduleNext();
      }, delay);
    };

    const now = new Date();
    if (now.getHours() >= 8) {
      runArxivGatekeeper();
    }

    const timer = scheduleNext();
    return () => {
      window.clearTimeout(timer);
    };
  }, [arxivFeed, runArxivGatekeeper]);

  useEffect(() => {
    if (!autoSyncEnabled) {
      return;
    }

    handleAutoSyncAll();
    const timer = window.setInterval(() => {
      handleAutoSyncAll();
    }, 15 * 60 * 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [autoSyncEnabled, handleAutoSyncAll]);

  const handleToggleRead = useCallback(async () => {
    if (!selectedArticle) {
      return;
    }
    await updateArticleFlags(
      selectedArticle.id,
      !selectedArticle.is_read,
      selectedArticle.is_favorite
    );
  }, [selectedArticle, updateArticleFlags]);

  const handleToggleFavorite = useCallback(async () => {
    if (!selectedArticle) {
      return;
    }
    await updateArticleFlags(
      selectedArticle.id,
      selectedArticle.is_read,
      !selectedArticle.is_favorite
    );
  }, [selectedArticle, updateArticleFlags]);

  const handleDecreaseFont = () => {
    setReaderFontSize((value) => Math.max(14, value - 1));
  };

  const handleIncreaseFont = () => {
    setReaderFontSize((value) => Math.min(24, value + 1));
  };

  const handleToggleFocusMode = () => {
    setIsFocusMode((value) => !value);
  };

  const handleSelectNeighbor = useCallback(
    (delta: number) => {
      if (!selectedArticle || visibleArticles.length === 0) {
        return;
      }
      const index = visibleArticles.findIndex((article) => article.id === selectedArticle.id);
      if (index < 0) {
        return;
      }
      const next = visibleArticles[index + delta];
      if (next) {
        setSelectedArticle(next);
      }
    },
    [selectedArticle, visibleArticles]
  );

  const deriveFaviconUrl = useCallback((feed: (typeof feeds)[number]) => {
    const candidate = feed.site_url || feed.url;
    if (!candidate) {
      return null;
    }

    try {
      const url = new URL(candidate);
      return `${url.origin}/favicon.ico`;
    } catch {
      return null;
    }
  }, []);

  const buildHeadingSelector = useCallback((id: string) => {
    return typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? `#${CSS.escape(id)}`
      : `#${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  }, []);

  const tocItemClassName = useCallback(
    (item: { id: string; level: number }) => {
      const isActive = item.id === activeTocId;
      return [
        "w-full text-left text-sm transition-colors",
        item.level === 3 ? "pl-4" : "",
        isActive
          ? "font-medium text-foreground"
          : "text-muted-foreground hover:text-foreground",
      ]
        .filter(Boolean)
        .join(" ");
    },
    [activeTocId]
  );

  const handleTocJump = useCallback((id: string) => {
    const container = contentRef.current;
    if (!container) {
      return;
    }
    const selector = buildHeadingSelector(id);
    const target = container.querySelector(selector) as HTMLElement | null;
    if (!target) {
      return;
    }
    setActiveTocId(id);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [buildHeadingSelector]);

  const buildContentHtml = useCallback((html: string, baseUrl?: string) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const isWechat = (() => {
      if (baseUrl?.includes("mp.weixin.qq.com")) {
        return true;
      }
      if (baseUrl?.includes("wechat2rss.")) {
        return true;
      }
      return Boolean(doc.querySelector("#js_content, .rich_media_content"));
    })();

    const simplifyToMinimal = () => {
      const allowed = new Set([
        "article",
        "section",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "blockquote",
        "pre",
        "code",
        "ul",
        "ol",
        "li",
        "strong",
        "em",
        "b",
        "i",
        "hr",
        "br",
        "a",
        "img",
      ]);

      const elements = Array.from(doc.body.querySelectorAll("*"));
      elements.forEach((el) => {
        const tag = el.tagName.toLowerCase();
        if (!allowed.has(tag)) {
          const parent = el.parentNode;
          if (!parent) {
            return;
          }
          while (el.firstChild) {
            parent.insertBefore(el.firstChild, el);
          }
          parent.removeChild(el);
          return;
        }

        const attrs = Array.from(el.attributes).map((a) => a.name);
        attrs.forEach((name) => {
          if (
            name === "href" ||
            name === "src" ||
            name === "alt" ||
            name === "title" ||
            name === "width" ||
            name === "height"
          ) {
            return;
          }
          el.removeAttribute(name);
        });
      });

      Array.from(doc.body.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote")).forEach(
        (el) => {
          if (!(el.textContent || "").trim() && !el.querySelector("img, code")) {
            el.remove();
          }
        }
      );

      const promoKeywords = [
        "关注",
        "公众号",
        "扫码",
        "二维码",
        "广告",
        "推广",
        "赞助",
        "原创",
        "大淘宝技术引领新消费",
      ];

      Array.from(doc.body.querySelectorAll("p, div, section, aside, figure, figcaption")).forEach((el) => {
        const text = (el.textContent || "").replace(/\s+/g, "").trim();
        if (!text) {
          return;
        }
        const hit = promoKeywords.some((k) => text.includes(k));
        if (hit && text.length <= 120) {
          el.remove();
        }
      });

      Array.from(doc.body.querySelectorAll("img")).forEach((img) => {
        const hint = [img.getAttribute("alt"), img.getAttribute("title"), img.getAttribute("src")]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const hit =
          hint.includes("logo") ||
          hint.includes("qrcode") ||
          hint.includes("qr") ||
          hint.includes("banner") ||
          hint.includes("ad") ||
          hint.includes("promo");
        if (hit) {
          img.remove();
          return;
        }

        const textAround = ((img.parentElement?.textContent || "") + " " +
          (img.closest("figure")?.textContent || ""))
          .replace(/\s+/g, "")
          .trim();
        if (
          promoKeywords.some((k) => textAround.includes(k)) &&
          textAround.length <= 120
        ) {
          img.remove();
        }
      });

      const removeLeadingPromoBlocks = () => {
        const children = Array.from(doc.body.children);
        let removed = 0;
        for (const node of children) {
          if (removed >= 2) {
            break;
          }
          const text = (node.textContent || "").replace(/\s+/g, "").trim();
          const images = node.querySelectorAll("img").length;
          const hasParagraph = node.querySelectorAll("p").length > 0;
          const isLikelyHeroImageBlock = images > 0 && (!text || text.length < 40) && !hasParagraph;
          const hasPromoText = promoKeywords.some((k) => text.includes(k));

          if (isLikelyHeroImageBlock || hasPromoText) {
            node.remove();
            removed += 1;
            continue;
          }

          if (text.length > 80 || hasParagraph) {
            break;
          }
        }
      };

      removeLeadingPromoBlocks();
    };

    if (isWechat) {
      doc.body.setAttribute("data-source", "wechat");
      const main = doc.querySelector("#js_content, .rich_media_content");
      if (main && main.innerHTML.trim()) {
        doc.body.innerHTML = main.innerHTML;
        doc.body.setAttribute("data-source", "wechat");
      }
      const junkSelectors = [
        "script",
        "style",
        "noscript",
        "iframe",
        ".rich_media_title",
        ".rich_media_meta_list",
        ".rich_media_tool",
        ".rich_media_area_extra",
        ".original_area_primary",
        ".js_recommend_list",
        "#meta_content",
        "#js_tags",
        "#js_pc_qr_code",
      ];
      junkSelectors.forEach((selector) => {
        doc.querySelectorAll(selector).forEach((node) => {
          node.remove();
        });
      });
      doc.querySelectorAll("[style*='display:none'], [hidden]").forEach((node) => {
        node.remove();
      });

      const allElements = Array.from(doc.body.querySelectorAll("*"));
      allElements.forEach((el) => {
        if (el.tagName === "PRE" || el.tagName === "CODE") {
          return;
        }
        el.removeAttribute("style");
        el.removeAttribute("class");
        if (el.tagName !== "A" && el.tagName !== "IMG") {
          el.removeAttribute("id");
        }
      });

      doc.body.removeAttribute("style");
      doc.body.removeAttribute("class");
      simplifyToMinimal();
    }

    const toAbsoluteUrl = (value: string | null) => {
      if (!value) {
        return null;
      }
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      if (!baseUrl) {
        return trimmed;
      }
      try {
        return new URL(trimmed, baseUrl).toString();
      } catch {
        return trimmed;
      }
    };

    const images = Array.from(doc.querySelectorAll("img"));
    images.forEach((img) => {
      const srcCandidate =
        img.getAttribute("src") ||
        img.getAttribute("data-src") ||
        img.getAttribute("data-original") ||
        img.getAttribute("data-actualsrc") ||
        img.getAttribute("data-lazy-src");
      const resolvedSrc = toAbsoluteUrl(srcCandidate);
      if (resolvedSrc) {
        img.setAttribute("src", resolvedSrc);
      }
      img.removeAttribute("data-src");
      img.removeAttribute("data-original");
      img.removeAttribute("data-actualsrc");
      img.removeAttribute("data-lazy-src");
      img.setAttribute("loading", "lazy");
      img.setAttribute("decoding", "async");
      if (!img.getAttribute("referrerpolicy")) {
        img.setAttribute("referrerpolicy", "no-referrer");
      }

      const width = Number.parseInt(img.getAttribute("width") || "", 10);
      const height = Number.parseInt(img.getAttribute("height") || "", 10);
      const isSmallByAttr =
        (Number.isFinite(width) && width > 0 && width <= 320) ||
        (Number.isFinite(height) && height > 0 && height <= 140);

      const hint = `${img.getAttribute("alt") || ""} ${img.getAttribute("title") || ""} ${
        img.getAttribute("src") || ""
      }`.toLowerCase();
      const isLikelyFormulaByHint =
        hint.includes("latex") || hint.includes("katex") || hint.includes("math") || hint.includes("formula");

      const parent = img.parentElement;
      let hasNearbyText = false;
      if (parent && ["P", "LI", "SPAN", "DIV"].includes(parent.tagName)) {
        const clone = parent.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("img").forEach((node) => {
          node.remove();
        });
        const text = (clone.textContent || "").replace(/\s+/g, "").trim();
        hasNearbyText = text.length >= 6;
      }

      if (isSmallByAttr || isLikelyFormulaByHint || hasNearbyText) {
        img.setAttribute("data-inline-formula", "true");
      }
    });

    const anchors = Array.from(doc.querySelectorAll("a"));
    anchors.forEach((a) => {
      const resolvedHref = toAbsoluteUrl(a.getAttribute("href"));
      if (resolvedHref) {
        a.setAttribute("href", resolvedHref);
      }
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });

    const headings = Array.from(doc.querySelectorAll("h2, h3"));
    const used = new Map<string, number>();
    headings.forEach((heading, index) => {
      const raw = heading.textContent?.trim() || "";
      let base = raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      if (!base) {
        base = `section-${index + 1}`;
      }
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      const id = count > 0 ? `${base}-${count + 1}` : base;
      heading.setAttribute("id", id);
    });

    const cleaned = doc.body.innerHTML;
    if (isWechat) {
      return `<div data-source="wechat">${cleaned}</div>`;
    }
    return cleaned;
  }, []);

  useEffect(() => {
    if (!selectedArticle) {
      setContentHtml("");
      setContentError(null);
      setContentSource(null);
      setReadProgress(0);
      setAiError(null);
      setIsTocOpen(false);
      return;
    }

    let cancelled = false;
    const loadContent = async () => {
      setContentLoading(true);
      setContentError(null);
      setAiError(null);
      if (selectedArticle.content) {
        const html = buildContentHtml(selectedArticle.content, selectedArticle.url);
        if (!cancelled) {
          setContentHtml(html);
          setContentSource("full");
          setContentLoading(false);
        }
        return;
      }

      const article = await fetchArticleContent(selectedArticle.id);
      if (cancelled) {
        return;
      }

      if (article?.content) {
        setContentHtml(buildContentHtml(article.content, article.url || selectedArticle.url));
        setContentSource("full");
      } else {
        const fallback = article?.summary || selectedArticle.summary || "";
        setContentHtml(fallback);
        setContentSource(fallback.trim() ? "summary" : null);
        if (!article) {
          setContentError(useDataStore.getState().error || "全文抓取失败");
        } else if (!fallback.trim()) {
          setContentError("文章暂无可显示内容");
        } else {
          setContentError(null);
        }
      }
      setContentLoading(false);
    };

    loadContent();
    lastSavedProgressRef.current = selectedArticle.read_progress || 0;
    setReadProgress(selectedArticle.read_progress || 0);

    return () => {
      cancelled = true;
    };
  }, [buildContentHtml, fetchArticleContent, selectedArticle]);


  const handleAnalyzeArticle = useCallback(
    async (force?: boolean) => {
      if (!selectedArticle) {
        return;
      }
      setAiLoading(true);
      setAiError(null);
      const result = await analyzeArticle(selectedArticle.id, force);
      if (!result) {
        setAiError(useDataStore.getState().error || "AI 分析失败");
      }
      setAiLoading(false);
    },
    [analyzeArticle, selectedArticle]
  );

  useEffect(() => {
    if (!contentHtml || !contentRef.current) {
      return;
    }

    const blocks = contentRef.current.querySelectorAll("pre code");
    blocks.forEach((block) => {
      hljs.highlightElement(block as HTMLElement);
    });
  }, [contentHtml]);

  useEffect(() => {
    if (!contentHtml) {
      setTocItems([]);
      setActiveTocId(null);
      return;
    }
    const doc = new DOMParser().parseFromString(contentHtml, "text/html");
    const headings = Array.from(doc.querySelectorAll("h2, h3"));
    const items = headings
      .map((heading) => ({
        id: heading.getAttribute("id") || "",
        text: heading.textContent?.trim() || "",
        level: heading.tagName === "H3" ? 3 : 2,
      }))
      .filter((item) => item.id && item.text);
    setTocItems(items);
    setActiveTocId(items[0]?.id ?? null);
  }, [contentHtml]);

  useEffect(() => {
    if (!contentRef.current || tocItems.length === 0) {
      return;
    }

    const container = contentRef.current;
    const headings = tocItems
      .map((item) => {
        const element = container.querySelector(buildHeadingSelector(item.id));
        if (!element) {
          return null;
        }
        return {
          id: item.id,
          element: element as HTMLElement,
        };
      })
      .filter((item): item is { id: string; element: HTMLElement } => item !== null);

    if (headings.length === 0) {
      return;
    }

    const syncActiveHeading = () => {
      const containerTop = container.getBoundingClientRect().top;
      let currentId = headings[0].id;
      for (const heading of headings) {
        if (heading.element.getBoundingClientRect().top - containerTop <= 72) {
          currentId = heading.id;
        } else {
          break;
        }
      }
      setActiveTocId((prev) => (prev === currentId ? prev : currentId));
    };

    syncActiveHeading();
    container.addEventListener("scroll", syncActiveHeading, { passive: true });
    window.addEventListener("resize", syncActiveHeading);

    return () => {
      container.removeEventListener("scroll", syncActiveHeading);
      window.removeEventListener("resize", syncActiveHeading);
    };
  }, [buildHeadingSelector, tocItems]);

  useEffect(() => {
    if (!selectedArticle || !contentRef.current) {
      return;
    }

    const container = contentRef.current;
    const handleScroll = () => {
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (maxScroll <= 0) {
        return;
      }
      const progress = Math.min(100, Math.max(0, (container.scrollTop / maxScroll) * 100));
      setReadProgress(progress);

      if (Math.abs(progress - lastSavedProgressRef.current) >= 1) {
        lastSavedProgressRef.current = progress;
        const isRead = progress >= 95;
        updateArticleProgress(selectedArticle.id, progress, isRead);
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [selectedArticle, updateArticleProgress]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        handleSelectNeighbor(1);
        return;
      }

      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        handleSelectNeighbor(-1);
        return;
      }

      if (event.key === "f") {
        event.preventDefault();
        handleToggleFavorite();
        return;
      }

      if (event.key === "r") {
        event.preventDefault();
        handleToggleRead();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleSelectNeighbor, handleToggleFavorite, handleToggleRead]);

  useEffect(() => {
    const pending = feeds.filter((feed) => !feed.favicon_url);
    if (pending.length === 0) {
      return;
    }

    pending.forEach((feed) => {
      const faviconUrl = deriveFaviconUrl(feed);
      if (!faviconUrl) {
        return;
      }
      updateFeedFavicon(feed.id, faviconUrl);
    });
  }, [deriveFaviconUrl, feeds, updateFeedFavicon]);

  const handleDeleteFeed = async (feedId: string) => {
    const ok = await deleteFeed(feedId);
    if (!ok) {
      setSeedStatus(useDataStore.getState().error || "删除失败");
      setConfirmDeleteFeedId(null);
      return;
    }

    if (selectedFeed === feedId) {
      setSelectedFeed(null);
      setSelectedArticle(null);
    }
    setConfirmDeleteFeedId(null);
    setSeedStatus("订阅源已删除");
  };

  return (
    <div
      className="flex h-screen w-full bg-background text-foreground overflow-hidden"
      onPointerDownCapture={handleDragPointerDown}
      role="application"
      tabIndex={-1}
      onKeyDown={() => {}}
    >
      {!isFocusMode && (
        <>
          {/* Left Sidebar: Categories & Feeds */}
          <aside className="w-[240px] min-w-[240px] border-r border-border bg-card flex flex-col overflow-x-hidden">
            {/* Header */}
            <div className="h-12 flex items-center gap-2 border-b border-border px-3 pl-16 pt-3">
              <h1 className="text-lg font-bold">Cortex</h1>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-8 w-8"
                onClick={() => setIsDarkMode(!isDarkMode)}
                data-tauri-drag-region={false}
              >
                {isDarkMode ? "☀️" : "🌙"}
              </Button>
            </div>

            {/* Add Feed Button */}
            <div className="p-2" data-tauri-drag-region={false}>
              <Button
                className="w-full h-auto py-2.5 text-sm leading-5 whitespace-normal"
                size="default"
                data-tauri-drag-region={false}
                onClick={handleToggleAddForm}
                disabled={seedLoading}
              >
                {showAddForm ? (editingFeedId ? "收起编辑" : "收起") : "+ 添加订阅源"}
              </Button>
              {showAddForm && (
                <div className="mt-3 space-y-2 text-xs">
                  <input
                    type="text"
                    placeholder="订阅名称"
                    value={feedTitle}
                    onChange={(event) => setFeedTitle(event.target.value)}
                    className="no-drag w-full bg-background border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring"
                    data-tauri-drag-region={false}
                  />
                  <input
                    type="text"
                    placeholder="源地址 URL (必填)"
                    value={feedUrl}
                    onChange={(event) => setFeedUrl(event.target.value)}
                    className="no-drag w-full bg-background border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring"
                    data-tauri-drag-region={false}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    data-tauri-drag-region={false}
                    onClick={handleDetectSourceConfig}
                    disabled={seedLoading}
                  >
                    自动识别来源类型
                  </Button>
                  <select
                    className="no-drag w-full bg-background border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring"
                    value={feedSourceType}
                    onChange={(event) =>
                      setFeedSourceType(event.target.value === "web_api" ? "web_api" : "rss")
                    }
                    data-tauri-drag-region={false}
                  >
                    <option value="rss">RSS / Atom</option>
                    <option value="web_api">Web API（通用 JSON）</option>
                  </select>
                  {feedSourceType === "web_api" && (
                    <textarea
                      placeholder='Web API JSON 配置（可选）\nGET 示例：{"provider":"generic_json","endpoint":"https://example.com/api/posts","query":{"limit":"20"},"items_path":"data.items","fields":{"title":"title","url":"url","summary":"summary","pub_date":"published_at"}}\nPOST 分页示例：{"provider":"generic_json","method":"POST","endpoint":"https://cloud.tencent.com/developer/api/column/getArticlesByColumnId","body":{"pageNumber":"{{next}}","columnId":5286,"tagId":-1,"keyword":""},"items_path":"list","fields":{"title":"title","url":"url","url_template":"https://cloud.tencent.com/developer/article/{{articleId}}","summary":"summary","pub_date":"createTime"},"pagination":{"mode":"page_number","start":"1","max_pages":20}}'
                      value={feedSourceConfig}
                      onChange={(event) => setFeedSourceConfig(event.target.value)}
                      className="no-drag min-h-20 w-full bg-background border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring"
                      data-tauri-drag-region={false}
                    />
                  )}
                  <input
                    type="text"
                    placeholder="站点地址 (可选)"
                    value={feedSiteUrl}
                    onChange={(event) => setFeedSiteUrl(event.target.value)}
                    className="no-drag w-full bg-background border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring"
                    data-tauri-drag-region={false}
                  />
                  <select
                    className="no-drag w-full bg-background border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring"
                    value={feedCategoryId || ""}
                    onChange={(event) => setFeedCategoryId(event.target.value || null)}
                    data-tauri-drag-region={false}
                  >
                    <option value="">未分类</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      size="sm"
                      data-tauri-drag-region={false}
                      onClick={handleSaveFeed}
                      disabled={seedLoading}
                    >
                      {editingFeedId ? "保存修改" : "保存"}
                    </Button>
                    <Button
                      className="flex-1"
                      size="sm"
                      variant="ghost"
                      data-tauri-drag-region={false}
                      onClick={closeFeedForm}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              )}
              {seedStatus && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {seedStatus}
                </div>
              )}
              <button
                type="button"
                className="mt-2 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={handleAddQqAuthorSample}
                data-tauri-drag-region={false}
              >
                添加腾讯作者测试源
              </button>
              <button
                type="button"
                className="mt-2 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={handleAddSampleData}
                data-tauri-drag-region={false}
              >
                快速添加示例订阅
              </button>
            </div>
            <div className="px-3 pb-3">
              <div className="text-[11px] font-semibold text-muted-foreground tracking-wider mb-2">
                分类管理
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="新分类名称"
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  className="no-drag flex-1 bg-background border border-border rounded-md px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                  data-tauri-drag-region={false}
                />
                <Button
                  size="sm"
                  className="px-3 h-8 text-[11px] shrink-0"
                  data-tauri-drag-region={false}
                  onClick={handleCreateCategory}
                >
                  添加
                </Button>
              </div>
            </div>

            {/* Categories & Feeds List */}
            <div className="flex-1 overflow-y-auto">
              {/* All Items */}
              <div className="px-3 py-1">
                <button
                  type="button"
                  className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    selectedCategory === null && selectedFeed === null
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  }`}
                  onClick={() => {
                    setFilterMode("all");
                    setSelectedCategory(null);
                    setSelectedFeed(null);
                  }}
                  data-tauri-drag-region={false}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">全部文章</span>
                    {totalUnread > 0 && (
                      <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                        {totalUnread}
                      </span>
                    )}
                  </div>
                </button>
              </div>
              <div className="px-3 py-1">
                <button
                  type="button"
                  className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    filterMode === "unread"
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  }`}
                  onClick={() => {
                    setFilterMode("unread");
                    setSelectedCategory(null);
                    setSelectedFeed(null);
                  }}
                  data-tauri-drag-region={false}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">未读</span>
                    {totalUnread > 0 && (
                      <span className="text-xs text-muted-foreground">{totalUnread}</span>
                    )}
                  </div>
                </button>
              </div>
              <div className="px-3 py-1">
                <button
                  type="button"
                  className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    filterMode === "favorites"
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  }`}
                  onClick={() => {
                    setFilterMode("favorites");
                    setSelectedCategory(null);
                    setSelectedFeed(null);
                  }}
                  data-tauri-drag-region={false}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">收藏</span>
                  </div>
                </button>
              </div>

              {/* All Feeds */}
              <div className="px-3 py-2">
                <button
                  type="button"
                  className="w-full flex items-center justify-between text-[10px] font-semibold text-muted-foreground tracking-wide mb-1"
                  onClick={() => setAllFeedsCollapsed((value) => !value)}
                  data-tauri-drag-region={false}
                >
                  <span>全部订阅源</span>
                  <span className="text-xs">{allFeedsCollapsed ? "▶" : "▼"}</span>
                </button>
                {!allFeedsCollapsed && (
                  <div className="space-y-1">
                    {feeds.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">暂无订阅源</div>
                    ) : (
                      feeds.map((feed) => (
                        <div
                          key={`all-${feed.id}`}
                          className={`group w-full px-3 py-2 rounded-md text-sm transition-colors ${
                            selectedFeed === feed.id
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-accent/50"
                          }`}
                          data-tauri-drag-region={false}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              className="flex-1 text-left"
                              onClick={() => {
                                setSelectedFeed(feed.id);
                                setSelectedCategory(null);
                                setConfirmDeleteFeedId(null);
                              }}
                              data-tauri-drag-region={false}
                            >
                              <span className="flex items-center gap-2">
                                {feed.favicon_url ? (
                                  <img
                                    src={feed.favicon_url}
                                    alt=""
                                    className="h-4 w-4 rounded-sm"
                                    loading="lazy"
                                  />
                                ) : (
                                  <span className="h-4 w-4 rounded-sm bg-muted text-[10px] text-muted-foreground flex items-center justify-center">
                                    {feed.title.slice(0, 1)}
                                  </span>
                                )}
                                <span className="truncate">{feed.title}</span>
                              </span>
                            </button>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {unreadCounts.get(feed.id) ? (
                                <span>{unreadCounts.get(feed.id)}</span>
                              ) : null}
                              {confirmDeleteFeedId === feed.id ? (
                                <>
                                  <button
                                    type="button"
                                    className="text-destructive"
                                    onClick={() => handleDeleteFeed(feed.id)}
                                    data-tauri-drag-region={false}
                                  >
                                    确认
                                  </button>
                                  <button
                                    type="button"
                                    className="hover:text-foreground"
                                    onClick={() => setConfirmDeleteFeedId(null)}
                                    data-tauri-drag-region={false}
                                  >
                                    取消
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => handleStartEditFeed(feed)}
                                    data-tauri-drag-region={false}
                                    aria-label="编辑订阅源"
                                    title="编辑订阅源"
                                  >
                                    编辑
                                  </button>
                                  <button
                                    type="button"
                                    className="hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => handleRequestDeleteFeed(feed.id)}
                                    data-tauri-drag-region={false}
                                    aria-label="删除订阅源"
                                    title="删除订阅源"
                                  >
                                    ✕
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Categories */}
              {categories.map((category) => (
                <div key={category.id} className="px-3 py-1">
                  <div className="px-3 py-0.5 text-[10px] font-semibold text-muted-foreground tracking-wide flex items-center justify-between gap-2 leading-tight">
                    <span className="truncate" title={category.name}>
                      {category.name}
                    </span>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteCategory(category.id)}
                      data-tauri-drag-region={false}
                      aria-label="删除分类"
                      title="删除分类"
                    >
                      ✕
                    </button>
                  </div>
                  {/* Feeds under this category */}
                  {feeds
                    .filter((feed) => feed.category_id === category.id)
                    .map((feed) => (
                      <div
                        key={feed.id}
                        className={`group w-full px-3 py-2 rounded-md text-sm transition-colors ${
                          selectedFeed === feed.id
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/50"
                        }`}
                        data-tauri-drag-region={false}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            className="flex-1 text-left"
                            onClick={() => {
                              setSelectedFeed(feed.id);
                              setSelectedCategory(null);
                              setConfirmDeleteFeedId(null);
                            }}
                            data-tauri-drag-region={false}
                          >
                            <span className="flex items-center gap-2">
                              {feed.favicon_url ? (
                                <img
                                  src={feed.favicon_url}
                                  alt=""
                                  className="h-4 w-4 rounded-sm"
                                  loading="lazy"
                                />
                              ) : (
                                <span className="h-4 w-4 rounded-sm bg-muted text-[10px] text-muted-foreground flex items-center justify-center">
                                  {feed.title.slice(0, 1)}
                                </span>
                              )}
                              <span className="truncate">{feed.title}</span>
                            </span>
                          </button>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {unreadCounts.get(feed.id) ? (
                              <span>{unreadCounts.get(feed.id)}</span>
                            ) : null}
                            {confirmDeleteFeedId === feed.id ? (
                              <>
                                <button
                                  type="button"
                                  className="text-destructive"
                                  onClick={() => handleDeleteFeed(feed.id)}
                                  data-tauri-drag-region={false}
                                >
                                  确认
                                </button>
                                <button
                                  type="button"
                                  className="hover:text-foreground"
                                  onClick={() => setConfirmDeleteFeedId(null)}
                                  data-tauri-drag-region={false}
                                >
                                  取消
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => handleStartEditFeed(feed)}
                                  data-tauri-drag-region={false}
                                  aria-label="编辑订阅源"
                                  title="编辑订阅源"
                                >
                                  编辑
                                </button>
                                <button
                                  type="button"
                                  className="hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => handleRequestDeleteFeed(feed.id)}
                                  data-tauri-drag-region={false}
                                  aria-label="删除订阅源"
                                  title="删除订阅源"
                                >
                                  ✕
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              ))}
            </div>
            {selectedFeed && (
              <div className="border-t border-border p-3">
                <div className="text-xs text-muted-foreground mb-2">订阅源分类</div>
                <div className="flex gap-2">
                  <select
                    className="no-drag flex-1 bg-background border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    value={selectedFeedCategoryId ?? ""}
                    onChange={(event) =>
                      setSelectedFeedCategoryId(event.target.value || null)
                    }
                    data-tauri-drag-region={false}
                  >
                    <option value="">未分类</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    data-tauri-drag-region={false}
                    onClick={handleUpdateSelectedFeedCategory}
                  >
                    保存
                  </Button>
                </div>
              </div>
            )}
            <div className="border-t border-border p-3">
              <Button
                variant={autoSyncEnabled ? "secondary" : "ghost"}
                size="sm"
                className="w-full"
                data-tauri-drag-region={false}
                onClick={() => setAutoSyncEnabled((value) => !value)}
              >
                {autoSyncEnabled ? "自动同步：开" : "自动同步：关"}
              </Button>
            </div>
          </aside>

          {/* Middle: Article List */}
          <div className="w-[320px] min-w-[320px] border-r border-border bg-card flex flex-col">
            {/* Search Bar */}
            <div className="h-14 flex items-center px-4 border-b border-border gap-2">
              <input
                type="text"
                placeholder="搜索文章..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                ref={searchInputRef}
                className="no-drag flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                data-tauri-drag-region={false}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                data-tauri-drag-region={false}
              >
                🔍
              </Button>
              <Button
                size="sm"
                className="ml-2"
                data-tauri-drag-region={false}
                onClick={handleSyncFeed}
                disabled={syncLoading || !selectedFeed}
              >
                {syncLoading ? "抓取中" : "抓取"}
              </Button>
            </div>
            <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span>
                  {visibleArticles.length} 篇
                  {filterMode === "unread"
                    ? " · 未读"
                    : filterMode === "favorites"
                      ? " · 收藏"
                      : ""}
                </span>
              <select
                className="no-drag bg-background border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as typeof sortMode)}
                data-tauri-drag-region={false}
              >
                <option value="newest">最新优先</option>
                <option value="oldest">最早优先</option>
                <option value="unread">未读优先</option>
                <option value="score">AI 评分</option>
                <option value="title">标题排序</option>
              </select>
            </div>
              {selectedFeedInfo && (
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span>上次同步 {formatDateTime(selectedFeedInfo.last_fetch_at)}</span>
                  {selectedFeedInfo.last_fetch_error ? (
                    <span className="text-destructive truncate" title={selectedFeedInfo.last_fetch_error}>
                      {selectedFeedInfo.last_fetch_error}
                    </span>
                  ) : null}
                </div>
              )}
            </div>
            {syncStatus && (
              <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border">
                {syncStatus}
              </div>
            )}

            {/* Article List */}
            <div className="flex-1 overflow-y-auto">
              {visibleArticles.map((article) => (
                <button
                  type="button"
                  key={article.id}
                  className={`w-full text-left p-4 border-b border-border transition-colors ${
                    selectedArticle?.id === article.id
                      ? "bg-accent"
                      : "hover:bg-accent/50"
                  } ${article.is_read ? "opacity-60" : ""}`}
                  onClick={() => setSelectedArticle(article)}
                  data-tauri-drag-region={false}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className={`text-sm ${article.is_read ? "font-normal" : "font-semibold"} line-clamp-2`}>
                      {article.title}
                    </h3>
                      <div className="flex items-center gap-2">
                        {typeof article.ai_score === "number" && (
                          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                            {article.ai_score}
                          </span>
                        )}
                        {article.is_favorite && <span>⭐</span>}
                      </div>
                    </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {article.summary || ""}
                  </p>
                  <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                    <span>{article.author || "Unknown"}</span>
                    <span>
                      {article.pub_date ? new Date(article.pub_date).toLocaleDateString() : ""}
                    </span>
                  </div>
                </button>
              ))}
              {!loading && visibleArticles.length === 0 && (
                <div className="p-6 text-sm text-muted-foreground">
                  暂无文章，先添加一个订阅源。
                </div>
              )}
              {!loading && articles.length >= articleLimit && (
                <div className="p-4">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full"
                    data-tauri-drag-region={false}
                    onClick={handleLoadMore}
                  >
                    加载更多
                  </Button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Right: Article Reader */}
      <main className="flex-1 bg-background flex flex-col min-w-0">
        {selectedArticle ? (
          <>
            {/* Article Header */}
            <header
              className={`h-14 flex items-center border-b border-border ${
                isFocusMode ? "pl-24 pr-6" : "px-6"
              }`}
            >
              <div
                className={`flex items-center justify-between w-full ${
                  isFocusMode ? "max-w-3xl mx-auto" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    data-tauri-drag-region={false}
                    onClick={handleToggleRead}
                  >
                    {selectedArticle.is_read ? "标为未读" : "标为已读"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-tauri-drag-region={false}
                    onClick={handleToggleFavorite}
                  >
                    {selectedArticle.is_favorite ? "取消收藏" : "收藏"}
                  </Button>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1 rounded-md border border-border px-1 py-0.5">
                    <button
                      type="button"
                      className="h-6 w-6 text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={handleDecreaseFont}
                      data-tauri-drag-region={false}
                      aria-label="减小字号"
                      title="减小字号"
                    >
                      A-
                    </button>
                    <span className="text-[10px]">{readerFontSize}px</span>
                    <button
                      type="button"
                      className="h-6 w-6 text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={handleIncreaseFont}
                      data-tauri-drag-region={false}
                      aria-label="增大字号"
                      title="增大字号"
                    >
                      A+
                    </button>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-tauri-drag-region={false}
                    onClick={handleToggleFocusMode}
                  >
                    {isFocusMode ? "退出专注" : "专注模式"}
                  </Button>
                  {isFocusMode && tocItems.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      data-tauri-drag-region={false}
                      onClick={() => setIsTocOpen((value) => !value)}
                    >
                      {isTocOpen ? "隐藏目录" : "显示目录"}
                    </Button>
                  )}
                  <span>{readProgress.toFixed(0)}%</span>
                  {contentError && (
                    <span className="text-destructive">{contentError}</span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    asChild
                    data-tauri-drag-region={false}
                  >
                    <a
                      href={selectedArticle?.url || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      原文链接 ↗
                    </a>
                  </Button>
                </div>
              </div>
            </header>
            <div className="h-0.5 bg-border">
              <div
                className="h-full bg-primary transition-[width] duration-150"
                style={{ width: `${readProgress}%` }}
              />
            </div>

            {/* Article Content */}
            <article
              className={`flex-1 overflow-y-auto py-6 ${
                isFocusMode ? "px-6 max-w-3xl mx-auto w-full" : "px-8"
              }`}
              data-tauri-drag-region={false}
              ref={contentRef}
            >
              <div className={isFocusMode ? "" : "relative flex gap-6"}>
                <div className="min-w-0 flex-1">
                  <h1 className="text-3xl font-bold mb-4">{selectedArticle.title}</h1>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mb-8">
                    <span>{selectedArticle.author || "Unknown"}</span>
                    <span>•</span>
                    <span>
                      {selectedArticle.pub_date
                        ? new Date(selectedArticle.pub_date).toLocaleString()
                        : ""}
                    </span>
                    <span>•</span>
                    <span>{selectedArticle.content_extracted ? "全文" : "摘要"}</span>
                    {selectedFeedTitle && (
                      <>
                        <span>•</span>
                        <span>{selectedFeedTitle}</span>
                      </>
                    )}
                    {readMinutes !== null && (
                      <>
                        <span>•</span>
                        <span>{contentSource === "summary" ? `摘要约 ${readMinutes} 分钟` : `约 ${readMinutes} 分钟`}</span>
                      </>
                    )}
                  </div>
                  {contentLoading ? (
                    <div className="text-sm text-muted-foreground">正在加载全文...</div>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-border bg-card/40 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-muted-foreground">AI 解读</div>
                          <div className="flex items-center gap-2">
                            {typeof selectedArticle.ai_score === "number" && (
                              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                                评分 {selectedArticle.ai_score}
                              </span>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              data-tauri-drag-region={false}
                              onClick={() => handleAnalyzeArticle(!!selectedArticle.ai_summary)}
                              disabled={aiLoading}
                            >
                              {selectedArticle.ai_summary ? "重新生成" : "生成 AI 解读"}
                            </Button>
                          </div>
                        </div>
                        <div className="mt-2 space-y-2 text-sm text-foreground">
                          {aiLoading && (
                            <div className="text-xs text-muted-foreground">正在生成 AI 解读...</div>
                          )}
                          {aiError && (
                            <div className="text-xs text-destructive">{aiError}</div>
                          )}
                          {selectedArticle.ai_summary && (
                            <p className="leading-relaxed text-sm">{selectedArticle.ai_summary}</p>
                          )}
                          {selectedArticle.ai_notes && (
                            <div className="text-xs text-muted-foreground whitespace-pre-line">
                              {selectedArticle.ai_notes}
                            </div>
                          )}
                        </div>
                      </div>
                      {contentError && (
                        <Button
                          size="sm"
                          variant="ghost"
                          data-tauri-drag-region={false}
                          onClick={() => fetchArticleContent(selectedArticle.id)}
                        >
                          重试全文抓取
                        </Button>
                      )}
                      <div
                        className="reader-content prose prose-lg max-w-none dark:prose-invert prose-pre:bg-muted prose-pre:text-foreground prose-pre:rounded-lg prose-pre:px-4 prose-pre:py-3 prose-img:rounded-lg"
                        style={{
                          fontSize: `${readerFontSize}px`,
                          ["--reader-font-size" as string]: `${readerFontSize}px`,
                        }}
                      >
                        {parse(contentHtml || selectedArticle.summary || "")}
                      </div>
                    </div>
                  )}
                </div>
                {!isFocusMode && tocItems.length > 0 && (
                  <aside className="hidden xl:block w-48 shrink-0">
                    <div className="sticky top-24 rounded-lg border border-border bg-card/30 p-3">
                      <div className="text-xs font-semibold text-muted-foreground mb-2">目录</div>
                      <div className="space-y-1">
                        {tocItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className={tocItemClassName(item)}
                            onClick={() => handleTocJump(item.id)}
                            data-tauri-drag-region={false}
                          >
                            {item.text}
                          </button>
                        ))}
                      </div>
                    </div>
                  </aside>
                )}
              </div>
              {isFocusMode && tocItems.length > 0 && isTocOpen && (
                <aside className="hidden xl:block fixed right-6 top-24 w-56 z-20">
                  <div className="rounded-lg border border-border bg-card/90 p-3 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-muted-foreground">目录</div>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setIsTocOpen(false)}
                        data-tauri-drag-region={false}
                      >
                        隐藏
                      </button>
                    </div>
                    <div className="mt-2 space-y-1 max-h-[60vh] overflow-y-auto">
                      {tocItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={tocItemClassName(item)}
                          onClick={() => handleTocJump(item.id)}
                          data-tauri-drag-region={false}
                        >
                          {item.text}
                        </button>
                      ))}
                    </div>
                  </div>
                </aside>
              )}
            </article>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <p className="text-lg mb-2">选择一篇文章开始阅读</p>
              <p className="text-sm">或从左侧添加新的 RSS 订阅源</p>
              <div className="mt-4">
                <Button
                  size="sm"
                  variant="ghost"
                  data-tauri-drag-region={false}
                  onClick={handleToggleFocusMode}
                >
                  {isFocusMode ? "退出专注" : "专注模式"}
                </Button>
              </div>
              {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
