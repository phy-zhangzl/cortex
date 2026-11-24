import { forwardRef, memo, useEffect, useMemo, useRef, useState } from "react";
import { isCollection, isFavoritesScope, useAppStore } from "@/store/useAppStore";
import type { ArticleListItem, Scope } from "@/lib/api";
import { htmlToText } from "@/lib/content";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./Icon";
import { IconButton } from "./ui/icon-button";
import { Segmented } from "./ui/segmented";
import { Kbd } from "./ui/kbd";

export function relativeTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (Number.isNaN(diff)) return "";
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

const Row = memo(function Row({
  article,
  selected,
  showFeedName,
  onSelect,
  onToggleFavorite,
  onToggleLater,
}: {
  article: ArticleListItem;
  selected: boolean;
  showFeedName: boolean;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onToggleLater: (id: string) => void;
}) {
  const excerpt = useMemo(() => htmlToText(article.excerpt, 180), [article.excerpt]);
  const flagBtn = (on: boolean, icon: IconName, onClass: string, title: string, action: () => void) => (
    <button
      title={title}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md transition-all duration-100 hover:bg-background",
        on ? onClass : "text-muted-foreground/70 opacity-0 hover:text-foreground group-hover:opacity-100",
      )}
      onClick={(e) => {
        e.stopPropagation();
        action();
      }}
    >
      <Icon name={icon} filled={on && icon === "star"} className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <div
      data-id={article.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("cortex/article", article.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onSelect(article.id)}
      className={cn(
        "group relative mx-2 rounded-xl px-3 py-2.5 transition-colors duration-100",
        selected ? "bg-selected" : "hover:bg-foreground/[0.035]",
      )}
    >
      <div className="flex h-6 items-center gap-1.5 text-[11.5px] text-muted-foreground">
        {!article.is_read && <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-primary" aria-label="未读" />}
        {showFeedName && (
          <span className={cn("truncate", !article.is_read && "text-foreground/70")}>{article.feed_title ?? "已删除的订阅源"}</span>
        )}
        {showFeedName && <span className="text-muted-foreground/50">·</span>}
        <span className="shrink-0">{relativeTime(article.pub_date)}</span>
        <span className="flex-1" />
        {article.is_archived && (
          <span title="已存档到本地" className="text-muted-foreground/70">
            <Icon name="archive" className="h-3 w-3" />
          </span>
        )}
        {flagBtn(article.read_later, "clock", "text-primary", article.read_later ? "移出稍后读" : "稍后读", () => onToggleLater(article.id))}
        {flagBtn(article.is_favorite, "star", "text-star", article.is_favorite ? "取消收藏" : "收藏", () => onToggleFavorite(article.id))}
      </div>
      <div
        className={cn(
          "line-clamp-2 text-[14px] leading-[1.4] tracking-[-0.005em]",
          article.is_read ? "text-muted-foreground" : "font-semibold text-foreground",
        )}
      >
        {article.title}
      </div>
      {excerpt && (
        <div className={cn("mt-1 line-clamp-2 text-[12.5px] leading-[1.55]", article.is_read ? "text-muted-foreground/70" : "text-muted-foreground")}>
          {excerpt}
        </div>
      )}
    </div>
  );
});

function EmptyState({ icon, title, hint }: { icon: IconName; title: string; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-8 pt-24 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon name={icon} className="h-5 w-5" />
      </div>
      <div className="text-sm font-medium">{title}</div>
      {hint && <div className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hint}</div>}
    </div>
  );
}

export const ArticleList = forwardRef<HTMLInputElement>(function ArticleList(_, searchRef) {
  const {
    articles, selectedId, select, scope, feeds, categories, unreadOnly, setUnreadOnly, search, setSearch,
    hasMore, loadMore, listLoading, markScopeRead, toggleFavorite, toggleReadLater, exportMarkdown, counts, collections,
    setScope, fileToCollection,
  } = useAppStore();
  const [chipDrop, setChipDrop] = useState<string | null>(null);
  const favoritesView = isFavoritesScope(scope);
  const unfiledCount = Math.max(0, counts.favorites - collections.reduce((sum, c) => sum + c.count, 0));
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchTimer = useRef<number | undefined>(undefined);

  const title = useMemo(() => {
    switch (scope.kind) {
      case "favorites":
      case "unfiled":
        return "收藏";
      case "later":
        return "稍后读";
      case "collection":
        return "收藏";
      case "uncategorized":
        return "未分类";
      case "category":
        return categories.find((c) => c.id === scope.id)?.name ?? "分类";
      case "feed":
        return feeds.find((f) => f.id === scope.id)?.title ?? "订阅源";
      default:
        return "全部文章";
    }
  }, [scope, categories, feeds, collections]);

  const subtitle = useMemo(() => {
    if (scope.kind === "favorites") return `${counts.favorites} 篇 · 已保存在本地`;
    if (scope.kind === "unfiled") return `未分类 · ${unfiledCount} 篇`;
    if (scope.kind === "later") return `${counts.later} 篇`;
    if (scope.kind === "collection") {
      const c = collections.find((x) => x.id === scope.id);
      return `${c?.name ?? "收藏夹"} · ${c?.count ?? 0} 篇`;
    }
    if (scope.kind === "feed") return feeds.find((f) => f.id === scope.id)?.unread_count ? `${feeds.find((f) => f.id === scope.id)!.unread_count} 篇未读` : "没有未读";
    if (scope.kind === "all") return counts.unread ? `${counts.unread} 篇未读` : "没有未读";
    return null;
  }, [scope, counts, feeds, collections, unfiledCount]);

  const collection = isCollection(scope);
  const feedError = scope.kind === "feed" ? feeds.find((f) => f.id === scope.id)?.last_fetch_error : null;

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [scope]);

  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    listRef.current.querySelector(`[data-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const empty = () => {
    if (search.trim()) return <EmptyState icon="search" title="没有找到相关文章" hint="换个关键词试试" />;
    if (scope.kind === "favorites")
      return <EmptyState icon="star" title="还没有收藏" hint={<>阅读时按 <Kbd>F</Kbd> 收藏，全文和图片会保存到本地</>} />;
    if (scope.kind === "collection")
      return <EmptyState icon="folder" title="收藏夹是空的" hint="把文章拖到上方的收藏夹标签上，或阅读时点星标选择收藏夹" />;
    if (scope.kind === "unfiled") return <EmptyState icon="check" title="所有收藏都已归类" />;
    if (scope.kind === "later")
      return <EmptyState icon="clock" title="稍后读是空的" hint={<>遇到想晚点再看的文章，按 <Kbd>L</Kbd> 加进来</>} />;
    if (unreadOnly) return <EmptyState icon="check" title="全部读完了" hint="新文章会在同步后出现在这里" />;
    return <EmptyState icon="inbox" title="这里还没有文章" hint="只保留最近 30 天的文章" />;
  };

  return (
    <section className="flex h-full w-[360px] shrink-0 flex-col border-r border-border/70 bg-background">
      <header className="shrink-0 px-4 pb-3 pt-2.5" data-tauri-drag-region>
        <div className="flex h-9 items-center gap-2" data-tauri-drag-region>
          <div className="min-w-0 flex-1" data-tauri-drag-region>
            <h2 className="truncate text-[17px] font-semibold leading-tight tracking-tight" data-tauri-drag-region>
              {title}
            </h2>
            {subtitle && (
              <div className="text-[11.5px] text-muted-foreground" data-tauri-drag-region>
                {subtitle}
              </div>
            )}
          </div>
          {collection ? (
            favoritesView &&
            articles.length > 0 && (
              <IconButton
                label={scope.kind === "favorites" ? "导出全部收藏为 Markdown（按收藏夹分文件夹）" : "导出当前列表为 Markdown"}
                tipAlign="end"
                onClick={() => void exportMarkdown(scope.kind === "favorites" ? "favorites" : articles.map((a) => a.id))}
              >
                <Icon name="download" className="h-4 w-4" />
              </IconButton>
            )
          ) : (
            <>
              <Segmented
                value={unreadOnly}
                onChange={setUnreadOnly}
                options={[
                  { value: true, label: "未读" },
                  { value: false, label: "全部" },
                ]}
              />
              <IconButton label="全部标为已读" shortcut="⇧A" tipAlign="end" onClick={() => void markScopeRead()}>
                <Icon name="check" className="h-4 w-4" />
              </IconButton>
            </>
          )}
        </div>

        {favoritesView && collections.length > 0 && (
          <div className="no-drag -mx-1 mt-3 flex flex-wrap gap-1.5 px-1">
            {(
              [
                { key: "all", target: { kind: "favorites" } as Scope, label: "全部", count: counts.favorites, fileTo: undefined },
                { key: "unfiled", target: { kind: "unfiled" } as Scope, label: "未分类", count: unfiledCount, fileTo: null },
                ...collections.map((c) => ({
                  key: c.id,
                  target: { kind: "collection", id: c.id } as Scope,
                  label: c.name,
                  count: c.count,
                  fileTo: c.id as string | null,
                })),
              ] as Array<{ key: string; target: Scope; label: string; count: number; fileTo: string | null | undefined }>
            ).map((chip) => {
              const active =
                chip.target.kind === scope.kind && ("id" in chip.target ? chip.target.id : null) === ("id" in scope ? scope.id : null);
              return (
                <button
                  key={chip.key}
                  onClick={() => setScope(chip.target)}
                  onDragOver={(e) => {
                    if (chip.fileTo !== undefined && e.dataTransfer.types.includes("cortex/article")) {
                      e.preventDefault();
                      setChipDrop(chip.key);
                    }
                  }}
                  onDragLeave={() => setChipDrop((k) => (k === chip.key ? null : k))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setChipDrop(null);
                    const id = e.dataTransfer.getData("cortex/article");
                    if (id && chip.fileTo !== undefined) void fileToCollection(id, chip.fileTo);
                  }}
                  className={cn(
                    "inline-flex h-7 max-w-[11rem] items-center gap-1.5 rounded-full px-3 text-[12px] transition-colors duration-100",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted text-foreground/75 hover:bg-accent hover:text-foreground",
                    chipDrop === chip.key && "ring-2 ring-primary/50",
                  )}
                >
                  {chip.key !== "all" && chip.key !== "unfiled" && <Icon name="folder" className="h-3 w-3 shrink-0 opacity-70" />}
                  <span className="truncate">{chip.label}</span>
                  <span className={cn("tabular-nums", active ? "text-primary-foreground/75" : "text-muted-foreground")}>{chip.count}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="relative mt-3">
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            defaultValue={search}
            placeholder="搜索"
            className="no-drag h-8 w-full rounded-lg border border-transparent bg-muted pl-8 pr-9 text-[13px] outline-none transition-all placeholder:text-muted-foreground/80 focus:border-ring/50 focus:bg-background focus:ring-[3px] focus:ring-ring/15"
            onChange={(e) => {
              const value = e.target.value;
              window.clearTimeout(searchTimer.current);
              searchTimer.current = window.setTimeout(() => setSearch(value), 250);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                (e.target as HTMLInputElement).value = "";
                setSearch("");
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
            <Kbd>/</Kbd>
          </span>
        </div>

        {feedError && (
          <div className="mt-2.5 flex gap-2 rounded-lg bg-warning/10 px-2.5 py-2 text-[11.5px] leading-relaxed text-warning">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-2">同步出错：{feedError}</span>
          </div>
        )}
      </header>

      <div
        ref={listRef}
        className="flex-1 space-y-0.5 overflow-y-auto pb-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) void loadMore();
        }}
      >
        {articles.length === 0 && !listLoading && empty()}
        {articles.map((article) => (
          <Row
            key={article.id}
            article={article}
            selected={article.id === selectedId}
            showFeedName={scope.kind !== "feed"}
            onSelect={select}
            onToggleFavorite={toggleFavorite}
            onToggleLater={toggleReadLater}
          />
        ))}
        {hasMore && (
          <div className="flex justify-center py-3">
            <button className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => void loadMore()}>
              {listLoading ? "加载中…" : "加载更多"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
});
