import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js/lib/common";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, errorMessage, type Article } from "@/lib/api";
import { cleanArticleHtml, estimateReadMinutes } from "@/lib/content";
import { isMostlyChinese, needsTranslation, translateBlocks, type TranslationJob, type TranslationMode } from "@/lib/translate";
import { readPref, writePref } from "@/lib/prefs";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { FeedIcon } from "./FeedIcon";
import { IconButton } from "./ui/icon-button";
import { Segmented } from "./ui/segmented";
import { Popover, PopoverItem, PopoverSeparator } from "./ui/popover";
import { Kbd } from "./ui/kbd";

type FontFamily = "sans" | "serif";
type LineWidth = "narrow" | "normal" | "wide";
const WIDTH: Record<LineWidth, string> = { narrow: "36rem", normal: "42rem", wide: "50rem" };

/** Renders sanitized HTML once per string so DOM additions (translations) survive re-renders. */
const ArticleBody = memo(function ArticleBody({ html, onReady }: { html: string; onReady: (el: HTMLDivElement) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current) onReady(ref.current);
  }, [html, onReady]);
  return <div ref={ref} className="reader-content selectable" dangerouslySetInnerHTML={{ __html: html }} />;
});

function insertTranslation(root: HTMLElement, id: string, text: string) {
  if (root.querySelector(`.cx-tr[data-for="${id}"]`)) return;
  const el = root.querySelector<HTMLElement>(`[data-tid="${id}"]`);
  if (!el) return;
  const heading = /^H\d$/.test(el.tagName);
  const tr = document.createElement(heading ? "div" : "p");
  tr.className = heading ? "cx-tr cx-tr-heading" : "cx-tr";
  tr.dataset.for = id;
  tr.textContent = text;
  if (["LI", "TD", "TH", "DT", "DD"].includes(el.tagName)) {
    const src = document.createElement("span");
    src.className = "cx-src";
    while (el.firstChild) src.appendChild(el.firstChild);
    el.append(src, tr);
  } else {
    el.classList.add("cx-src");
    el.after(tr);
  }
}

function Divider() {
  return <span className="mx-1.5 h-4 w-px bg-border" />;
}

export function Reader({ articleId, focusMode, onToggleFocus }: { articleId: string; focusMode: boolean; onToggleFocus: () => void }) {
  const { toggleFavorite, toggleReadLater, setRead, toast, articles, exportMarkdown } = useAppStore();
  const listItem = articles.find((a) => a.id === articleId);

  const [article, setArticle] = useState<Article | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState<number>(() => readPref("reader-font-size", 17));
  const [fontFamily, setFontFamily] = useState<FontFamily>(() => readPref("reader-font", "sans"));
  const [lineWidth, setLineWidth] = useState<LineWidth>(() => readPref("reader-width", "normal"));
  const [mode, setMode] = useState<TranslationMode>("original");
  const [progress, setProgress] = useState(0);
  const [trState, setTrState] = useState<{ done: number; total: number; error: string | null }>({ done: 0, total: 0, error: null });
  const [titleTr, setTitleTr] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ open: boolean; loading: boolean; error: string | null }>({ open: false, loading: false, error: null });
  const [activeToc, setActiveToc] = useState<string | null>(null);
  const [typeOpen, setTypeOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const typeBtn = useRef<HTMLButtonElement | null>(null);
  const moreBtn = useRef<HTMLButtonElement | null>(null);
  const translations = useRef(new Map<string, string>());
  const translatedHtml = useRef<string | null>(null);
  const job = useRef<TranslationJob | null>(null);
  const savedProgress = useRef(0);

  // ── load article (+ full text when the feed only gave a teaser) ──
  useEffect(() => {
    let cancelled = false;
    job.current?.cancel();
    job.current = null;
    translations.current = new Map();
    translatedHtml.current = null;
    setArticle(null);
    setExtractError(null);
    setMode("original");
    setTrState({ done: 0, total: 0, error: null });
    setTitleTr(null);
    setSummary({ open: false, loading: false, error: null });
    setProgress(0);

    (async () => {
      try {
        const loaded = await api.getArticle(articleId);
        if (cancelled) return;
        setArticle(loaded);
        savedProgress.current = loaded.read_progress;
        if (!loaded.archived_html && !loaded.content_extracted) {
          setExtracting(true);
          try {
            const full = await api.loadFullContent(articleId);
            if (!cancelled) setArticle(full);
          } catch (error) {
            if (!cancelled) setExtractError(errorMessage(error));
          } finally {
            if (!cancelled) setExtracting(false);
          }
        }
      } catch (error) {
        if (!cancelled) toast(`打开文章失败：${errorMessage(error)}`, "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId, toast]);

  const source = article ? article.archived_html || article.content || article.summary || "" : "";
  const cleaned = useMemo(
    () => (article ? cleanArticleHtml(source, article.url, article.title) : null),
    [article?.id, article?.url, article?.title, source], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const isChinese = useMemo(
    () => (cleaned ? isMostlyChinese(`${article?.title ?? ""} ${cleaned.plainText.slice(0, 3000)}`) : true),
    [cleaned, article?.title],
  );
  const readMinutes = cleaned ? estimateReadMinutes(cleaned.plainText) : null;

  // ── translation (only when asked for, per article) ──
  const startTranslation = useCallback(() => {
    const root = bodyRef.current;
    if (!root || !article || job.current) return;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-tid]"))
      .map((el) => ({ id: el.dataset.tid!, text: (el.textContent || "").replace(/\s+/g, " ").trim() }))
      .filter((b) => needsTranslation(b.text) && !translations.current.has(b.id));
    const all = [...(needsTranslation(article.title) && !titleTr ? [{ id: "title", text: article.title }] : []), ...blocks];
    if (all.length === 0) return;

    setTrState({ done: 0, total: all.length, error: null });
    job.current = translateBlocks(all, (id, result) => {
      if ("error" in result) {
        setTrState((s) => ({ ...s, done: s.done + 1, error: s.error ?? result.error }));
        return;
      }
      if (id === "title") setTitleTr(result.text);
      else {
        translations.current.set(id, result.text);
        if (bodyRef.current) insertTranslation(bodyRef.current, id, result.text);
      }
      setTrState((s) => ({ ...s, done: s.done + 1 }));
    });
  }, [article, titleTr]);

  const onBodyReady = useCallback((el: HTMLDivElement) => {
    bodyRef.current = el;
    el.querySelectorAll<HTMLElement>("pre code").forEach((block) => hljs.highlightElement(block));
    translations.current.forEach((text, id) => insertTranslation(el, id, text));
  }, []);

  useEffect(() => {
    if (!cleaned || isChinese || mode === "original" || extracting) return;
    job.current?.cancel();
    job.current = null;
    if (translatedHtml.current !== cleaned.html) {
      translations.current = new Map();
      translatedHtml.current = cleaned.html;
    }
    const t = window.setTimeout(startTranslation, 0);
    return () => window.clearTimeout(t);
  }, [cleaned, isChinese, mode, extracting]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => job.current?.cancel(), []);

  // ── summary ──
  const runSummary = useCallback(
    async (regenerate = false) => {
      if (!article || !cleaned) return;
      if (article.ai_summary && !regenerate) {
        setSummary((s) => ({ ...s, open: !s.open }));
        return;
      }
      setSummary({ open: true, loading: true, error: null });
      try {
        const text = await api.summarizeArticle(article.id, cleaned.plainText);
        setArticle((a) => (a ? { ...a, ai_summary: text } : a));
        setSummary({ open: true, loading: false, error: null });
      } catch (error) {
        setSummary({ open: true, loading: false, error: errorMessage(error) });
      }
    },
    [article, cleaned],
  );

  const refetchFullText = useCallback(async () => {
    if (!article) return;
    setExtracting(true);
    setExtractError(null);
    try {
      setArticle(await api.loadFullContent(article.id, true));
    } catch (error) {
      setExtractError(errorMessage(error));
    } finally {
      setExtracting(false);
    }
  }, [article]);

  // ── progress + restore position ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !cleaned) return;
    const p = savedProgress.current;
    if (p > 5 && p < 95) requestAnimationFrame(() => (el.scrollTop = (p / 100) * (el.scrollHeight - el.clientHeight)));
    else el.scrollTop = 0;
  }, [articleId, cleaned?.html]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || !article) return;
    const max = el.scrollHeight - el.clientHeight;
    const value = max > 0 ? Math.min(100, (el.scrollTop / max) * 100) : 100;
    setProgress(value);
    if (Math.abs(value - savedProgress.current) >= 5 || (value >= 95 && savedProgress.current < 95)) {
      savedProgress.current = value;
      void api.updateProgress(article.id, value);
    }
    if (cleaned && cleaned.toc.length > 0 && bodyRef.current) {
      const top = el.getBoundingClientRect().top + 80;
      let current = cleaned.toc[0].id;
      for (const item of cleaned.toc) {
        const h = bodyRef.current.querySelector(`#${CSS.escape(item.id)}`);
        if (h && h.getBoundingClientRect().top <= top) current = item.id;
        else break;
      }
      setActiveToc(current);
    }
  };

  const changeFont = (delta: number) =>
    setFontSize((v) => {
      const next = Math.min(24, Math.max(14, v + delta));
      writePref("reader-font-size", next);
      return next;
    });

  // ── keyboard (reader-specific; list navigation lives in App) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[role=dialog]")) return;
      if (e.key === "t" && !isChinese) setMode((m) => (m === "original" ? "bilingual" : "original"));
      else if (e.key === "T" && !isChinese) setMode((m) => (m === "translated" ? "original" : "translated"));
      else if (e.key === "s") void runSummary();
      else if (e.key === "o" && article) void openUrl(article.url);
      else if (e.key === "=" || e.key === "+") changeFont(1);
      else if (e.key === "-") changeFont(-1);
      else if (e.key === " " && scrollRef.current) {
        e.preventDefault();
        scrollRef.current.scrollBy({ top: (e.shiftKey ? -1 : 1) * scrollRef.current.clientHeight * 0.85, behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onContentClick = (e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (anchor?.getAttribute("href")) {
      e.preventDefault();
      void openUrl(anchor.href);
    }
  };

  if (!article || !cleaned) {
    return (
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="h-[52px]" data-tauri-drag-region />
        <div className="mx-auto w-full max-w-[42rem] space-y-4 px-10 pt-10">
          <div className="h-3 w-40 animate-pulse rounded-full bg-muted" />
          <div className="h-7 w-4/5 animate-pulse rounded-lg bg-muted" />
          <div className="space-y-2.5 pt-4">
            {[100, 96, 92, 98, 70].map((w) => (
              <div key={w} className="h-3 animate-pulse rounded-full bg-muted" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      </main>
    );
  }

  const isFavorite = listItem?.is_favorite ?? article.is_favorite;
  const isLater = listItem?.read_later ?? article.read_later;
  const isRead = listItem?.is_read ?? article.is_read;
  const translating = trState.total > 0 && trState.done < trState.total;
  const feedLike = { title: article.feed_title ?? "?", url: article.url, site_url: null };

  return (
    <main className="relative flex min-w-0 flex-1 flex-col bg-background">
      <div className="absolute inset-x-0 top-0 z-10 h-[2px]">
        <div className="h-full bg-primary/70 transition-[width] duration-150" style={{ width: `${progress}%` }} />
      </div>

      <header className="flex h-[52px] shrink-0 items-center gap-0.5 border-b border-transparent px-3" data-tauri-drag-region>
        <div className={cn("flex-1", focusMode && "pl-20")} data-tauri-drag-region />

        {!isChinese && (
          <>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "original", label: "原文", title: "只看原文" },
                { value: "bilingual", label: "对照", title: "段落对照 (t)" },
                { value: "translated", label: "译文", title: "只看译文 (⇧T)" },
              ]}
            />
            <Divider />
          </>
        )}

        <IconButton label={isLater ? "移出稍后读" : "稍后读"} shortcut="L" active={isLater} onClick={() => void toggleReadLater(article.id)}>
          <Icon name="clock" className={cn("h-[17px] w-[17px]", isLater && "text-primary")} />
        </IconButton>
        <IconButton label={isFavorite ? "取消收藏" : "收藏并保存到本地"} shortcut="F" onClick={() => void toggleFavorite(article.id)}>
          <Icon name="star" filled={isFavorite} className={cn("h-[17px] w-[17px] transition-transform", isFavorite && "scale-110 text-star")} />
        </IconButton>
        <IconButton label="AI 摘要" shortcut="S" active={summary.open} onClick={() => void runSummary()}>
          <Icon name="sparkle" className="h-[17px] w-[17px]" />
        </IconButton>

        <Divider />

        <IconButton ref={typeBtn} label="排版" active={typeOpen} onClick={() => setTypeOpen((v) => !v)}>
          <Icon name="type" className="h-[17px] w-[17px]" />
        </IconButton>
        <IconButton label="在浏览器打开原文" shortcut="O" onClick={() => void openUrl(article.url)}>
          <Icon name="external" className="h-[16px] w-[16px]" />
        </IconButton>
        <IconButton ref={moreBtn} label="更多" active={moreOpen} tipAlign="end" onClick={() => setMoreOpen((v) => !v)}>
          <Icon name="more" className="h-[18px] w-[18px]" />
        </IconButton>
        <IconButton label={focusMode ? "退出专注" : "专注模式"} shortcut="\" tipAlign="end" active={focusMode} onClick={onToggleFocus}>
          <Icon name="sidebar" className="h-[16px] w-[16px]" />
        </IconButton>

        <Popover anchor={typeBtn} open={typeOpen} onClose={() => setTypeOpen(false)} className="w-64 space-y-3 p-3">
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-muted-foreground">字号</div>
            <div className="flex items-center gap-2">
              <button className="h-7 w-9 rounded-lg bg-muted text-xs hover:bg-accent" onClick={() => changeFont(-1)}>
                A
              </button>
              <div className="relative h-1 flex-1 rounded-full bg-muted">
                <div className="absolute inset-y-0 left-0 rounded-full bg-primary/70" style={{ width: `${((fontSize - 14) / 10) * 100}%` }} />
              </div>
              <button className="h-7 w-9 rounded-lg bg-muted text-base hover:bg-accent" onClick={() => changeFont(1)}>
                A
              </button>
              <span className="w-6 text-right text-[11px] tabular-nums text-muted-foreground">{fontSize}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-muted-foreground">字体</div>
            <Segmented
              className="w-full"
              size="md"
              value={fontFamily}
              onChange={(v) => {
                writePref("reader-font", v);
                setFontFamily(v);
              }}
              options={[
                { value: "sans", label: <span className="font-reading">无衬线</span> },
                { value: "serif", label: <span className="font-serif">衬线</span> },
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-muted-foreground">行宽</div>
            <Segmented
              className="w-full"
              size="md"
              value={lineWidth}
              onChange={(v) => {
                writePref("reader-width", v);
                setLineWidth(v);
              }}
              options={[
                { value: "narrow", label: "窄" },
                { value: "normal", label: "标准" },
                { value: "wide", label: "宽" },
              ]}
            />
          </div>
        </Popover>

        <Popover anchor={moreBtn} open={moreOpen} onClose={() => setMoreOpen(false)} className="w-56">
          {[
            {
              icon: <Icon name="dot" filled={isRead} className="h-3.5 w-3.5" />,
              label: isRead ? "标为未读" : "标为已读",
              hint: <Kbd>R</Kbd>,
              onSelect: () => void setRead(article.id, !isRead),
            },
            {
              icon: <Icon name="copy" className="h-3.5 w-3.5" />,
              label: "复制链接",
              onSelect: () => void navigator.clipboard.writeText(article.url).then(() => toast("链接已复制")),
            },
          ].map((item) => (
            <PopoverItem key={item.label} {...item} onSelect={() => (setMoreOpen(false), item.onSelect())} />
          ))}
          <PopoverSeparator />
          <PopoverItem
            icon={<Icon name="download" className="h-3.5 w-3.5" />}
            label="导出为 Markdown"
            onSelect={() => {
              setMoreOpen(false);
              void exportMarkdown([article.id]);
            }}
          />
          {!article.archived_html && (
            <PopoverItem
              icon={<Icon name="refresh" className="h-3.5 w-3.5" />}
              label="重新抓取全文"
              disabled={extracting}
              onSelect={() => {
                setMoreOpen(false);
                void refetchFullText();
              }}
            />
          )}
        </Popover>
      </header>

      <div ref={scrollRef} className="relative flex-1 overflow-y-auto" onScroll={onScroll}>
        <div className="mx-auto flex max-w-[72rem] justify-center gap-12 px-10 pb-28 pt-8">
          <article
            className={cn("min-w-0 flex-1", `cx-${mode}`, fontFamily === "serif" ? "font-serif" : "font-reading")}
            style={{ maxWidth: WIDTH[lineWidth] }}
          >
            <div className="mb-4 flex items-center gap-2 text-[12px] text-muted-foreground">
              <FeedIcon feed={feedLike} size={16} />
              <span className="font-medium text-foreground/75">{article.feed_title ?? "已删除的订阅源"}</span>
              {article.archived_at && (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10.5px] font-medium text-success">
                  <Icon name="archive" className="h-3 w-3" /> 已存档
                </span>
              )}
            </div>

            <h1 className="selectable font-semibold leading-[1.25] tracking-[-0.015em]" style={{ fontSize: `${Math.round(fontSize * 1.65)}px` }}>
              {mode === "translated" && titleTr ? titleTr : article.title}
            </h1>
            {mode === "bilingual" && titleTr && (
              <div className="selectable mt-2 font-medium leading-snug text-muted-foreground" style={{ fontSize: `${Math.round(fontSize * 1.15)}px` }}>
                {titleTr}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted-foreground">
              {article.author && <span>{article.author}</span>}
              {article.author && <span className="text-muted-foreground/40">·</span>}
              {article.pub_date && (
                <span>{new Date(article.pub_date).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}</span>
              )}
              {readMinutes && <span className="text-muted-foreground/40">·</span>}
              {readMinutes && <span>约 {readMinutes} 分钟</span>}
            </div>

            {(extracting || extractError) && (
              <Notice tone={extracting ? "info" : "warning"}>
                {extracting ? (
                  "正在抓取全文…"
                ) : (
                  <>
                    <span className="flex-1">全文抓取失败，显示的是订阅源提供的内容</span>
                    <button className="font-medium underline-offset-2 hover:underline" onClick={() => void refetchFullText()}>
                      重试
                    </button>
                  </>
                )}
              </Notice>
            )}

            {!isChinese && mode !== "original" && (translating || trState.error) && (
              <Notice tone={trState.error ? "warning" : "info"}>
                {trState.error ? (
                  <span className="flex-1">翻译出错：{trState.error}</span>
                ) : (
                  <>
                    <span className="flex-1">正在翻译</span>
                    <span className="tabular-nums">
                      {trState.done}/{trState.total}
                    </span>
                    <span className="h-1 w-20 overflow-hidden rounded-full bg-foreground/10">
                      <span className="block h-full bg-primary transition-[width]" style={{ width: `${(trState.done / trState.total) * 100}%` }} />
                    </span>
                  </>
                )}
              </Notice>
            )}

            {summary.open && (
              <div className="mt-6 rounded-2xl border border-primary/15 bg-primary/[0.04] p-5 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                <div className="mb-2.5 flex items-center gap-2 text-[12px] font-semibold text-primary">
                  <Icon name="sparkle" className="h-3.5 w-3.5" /> AI 摘要
                  <span className="flex-1" />
                  {!summary.loading && (
                    <button className="font-medium text-muted-foreground hover:text-foreground" onClick={() => void runSummary(true)}>
                      重新生成
                    </button>
                  )}
                </div>
                {summary.loading ? (
                  <div className="space-y-2">
                    {[95, 88, 60].map((w) => (
                      <div key={w} className="h-2.5 animate-pulse rounded-full bg-primary/10" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                ) : summary.error ? (
                  <div className="text-[13px] text-warning">{summary.error}</div>
                ) : (
                  <SummaryText text={article.ai_summary ?? ""} />
                )}
              </div>
            )}

            <div
              className="prose prose-neutral mt-8 max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-blockquote:border-l-primary/40 prose-blockquote:font-normal prose-blockquote:not-italic prose-pre:rounded-xl prose-pre:bg-muted prose-pre:text-foreground prose-img:rounded-xl"
              style={{ fontSize: `${fontSize}px` }}
              onClick={onContentClick}
            >
              {cleaned.html.trim() ? (
                <ArticleBody html={cleaned.html} onReady={onBodyReady} />
              ) : (
                !extracting && (
                  <p className="text-muted-foreground">
                    这篇文章没有可显示的内容，按 <Kbd>O</Kbd> 在浏览器中打开原文。
                  </p>
                )
              )}
            </div>

            <div className="mt-16 flex items-center justify-center">
              <button
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                onClick={() => void openUrl(article.url)}
              >
                阅读原文 <Icon name="external" className="h-3 w-3" />
              </button>
            </div>
          </article>

          {!focusMode && cleaned.toc.length >= 3 && (
            <aside className="sticky top-8 hidden max-h-[75vh] w-52 shrink-0 self-start overflow-y-auto 2xl:block">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">目录</div>
              <ul className="space-y-0.5 text-[12.5px]">
                {cleaned.toc.map((item) => (
                  <li key={item.id}>
                    <button
                      className={cn(
                        "block w-full rounded-md py-1 pr-2 text-left leading-snug transition-colors",
                        item.level === 3 ? "pl-5" : "pl-2",
                        activeToc === item.id ? "bg-selected font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() =>
                        bodyRef.current?.querySelector(`#${CSS.escape(item.id)}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
                      }
                    >
                      {item.text}
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      </div>
    </main>
  );
}

function Notice({ tone, children }: { tone: "info" | "warning"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "mt-6 flex items-center gap-3 rounded-xl px-4 py-2.5 font-reading text-[12.5px]",
        tone === "warning" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

/** Renders the model's "lead sentence + `- ` bullet" summary as a paragraph and a list. */
function SummaryText({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^[-*•]\s*/.test(l)).map((l) => l.replace(/^[-*•]\s*/, ""));
  const lead = lines.filter((l) => !/^[-*•]\s*/.test(l));
  return (
    <div className="selectable space-y-2.5 text-[14px] leading-relaxed text-foreground/90">
      {lead.map((l) => (
        <p key={l}>{l}</p>
      ))}
      {bullets.length > 0 && (
        <ul className="space-y-1.5">
          {bullets.map((b) => (
            <li key={b} className="flex gap-2.5">
              <span className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-primary/60" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
