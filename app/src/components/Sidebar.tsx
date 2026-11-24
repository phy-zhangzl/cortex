import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useAppStore } from "@/store/useAppStore";
import { api, errorMessage, type Category, type Feed, type Scope } from "@/lib/api";
import { readPref, writePref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { FeedIcon } from "./FeedIcon";
import { Icon, type IconName } from "./Icon";
import { Menu, type MenuItem } from "./ui/menu";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { IconButton } from "./ui/icon-button";
import { relativeTime } from "./ArticleList";

const UNCATEGORIZED = "__uncategorized__";

const sameScope = (a: Scope, b: Scope) =>
  a.kind === b.kind && ("id" in a ? a.id : null) === ("id" in b ? b.id : null);

function Count({ value, active }: { value: number; active?: boolean }) {
  if (value <= 0) return null;
  return (
    <span
      className={cn(
        "min-w-[1.5rem] rounded-full px-1.5 text-center text-[11px] font-medium tabular-nums leading-5",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      {value > 999 ? "999+" : value}
    </span>
  );
}

export function Sidebar({
  onAddFeed,
  onEditFeed,
  onOpenSettings,
  onOpenManager,
}: {
  onAddFeed: () => void;
  onEditFeed: (feed: Feed) => void;
  onOpenSettings: () => void;
  onOpenManager: () => void;
}) {
  const { categories, feeds, counts, scope, setScope, syncing, syncAll, refreshSidebar, toast, lastSync } = useAppStore();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => readPref("collapsed-categories", {}));
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const menuPos = useRef({ x: 0, y: 0 });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [draggingFeed, setDraggingFeed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null);
  const [, tick] = useState(0);

  // Keep "synced 3 minutes ago" fresh.
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const groups = useMemo(() => {
    const known = new Set(categories.map((c) => c.id));
    return {
      list: categories.map((category) => ({ category, feeds: feeds.filter((f) => f.category_id === category.id) })),
      loose: feeds.filter((f) => !f.category_id || !known.has(f.category_id)),
    };
  }, [categories, feeds]);

  const erroredFeeds = feeds.filter((f) => f.last_fetch_error).length;

  const toggleCollapsed = (id: string) => {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    writePref("collapsed-categories", next);
  };

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
    await refreshSidebar();
  };

  // ── drag & drop: feeds onto categories; categories onto categories (reorder) ──
  const onDragOver = (e: DragEvent, targetId: string) => {
    const types = e.dataTransfer.types;
    if (types.includes("cortex/feed") || (types.includes("cortex/category") && targetId !== UNCATEGORIZED)) {
      e.preventDefault();
      setDropTarget(targetId);
    }
  };
  const onDrop = (e: DragEvent, targetId: string) => {
    e.preventDefault();
    setDropTarget(null);
    setDraggingFeed(false);
    const feedId = e.dataTransfer.getData("cortex/feed");
    const categoryId = e.dataTransfer.getData("cortex/category");
    if (feedId) {
      void run(() => api.moveFeed(feedId, targetId === UNCATEGORIZED ? null : targetId));
    } else if (categoryId && categoryId !== targetId) {
      const ids = categories.map((c) => c.id).filter((id) => id !== categoryId);
      ids.splice(ids.indexOf(targetId), 0, categoryId);
      void run(() => api.reorderCategories(ids));
    }
  };

  const openMenu = (e: ReactMouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    menuPos.current = { x: e.clientX, y: e.clientY };
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const feedMenu = (feed: Feed): MenuItem[] => [
    { label: "立即同步", icon: <Icon name="refresh" className="h-3.5 w-3.5" />, onSelect: () => void syncAll([feed.id]) },
    { label: "编辑…", icon: <Icon name="edit" className="h-3.5 w-3.5" />, onSelect: () => onEditFeed(feed) },
    {
      label: "移到分类…",
      icon: <Icon name="folder" className="h-3.5 w-3.5" />,
      onSelect: () =>
        setMenu({
          ...menuPos.current,
          items: [
            ...categories.map((c) => ({ label: c.name, onSelect: () => void run(() => api.moveFeed(feed.id, c.id)) })),
            { separator: true as const },
            { label: "未分类", onSelect: () => void run(() => api.moveFeed(feed.id, null)) },
          ],
        }),
    },
  ];

  const categoryMenu = (category: Category): MenuItem[] => [
    {
      label: "同步此分类",
      icon: <Icon name="refresh" className="h-3.5 w-3.5" />,
      onSelect: () => void syncAll(feeds.filter((f) => f.category_id === category.id).map((f) => f.id)),
    },
    {
      label: "重命名",
      icon: <Icon name="edit" className="h-3.5 w-3.5" />,
      onSelect: () => {
        setRenamingId(category.id);
        setRenameValue(category.name);
      },
    },
    { separator: true },
    { label: "删除分类…", danger: true, icon: <Icon name="trash" className="h-3.5 w-3.5" />, onSelect: () => setConfirmDelete(category) },
  ];

  const submitRename = async (category: Category) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (name && name !== category.name) await run(() => api.renameCategory(category.id, name));
  };

  const submitCreate = async () => {
    const name = newName.trim();
    setCreating(false);
    setNewName("");
    if (name) await run(() => api.createCategory(name));
  };

  const rowBase =
    "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors duration-100";
  const rowState = (active: boolean) =>
    active ? "bg-selected font-medium text-foreground" : "text-foreground/80 hover:bg-foreground/[0.045] hover:text-foreground";

  const navItem = (target: Scope, label: string, count: number, icon: IconName, iconClass?: string) => {
    const active = sameScope(scope, target);
    return (
      <button className={cn(rowBase, "h-8", rowState(active))} onClick={() => setScope(target)}>
        <Icon name={icon} className={cn("h-[17px] w-[17px]", active ? "text-primary" : iconClass ?? "text-muted-foreground")} />
        <span className="flex-1 text-left">{label}</span>
        <Count value={count} active={active} />
      </button>
    );
  };

  const feedRow = (feed: Feed) => {
    const active = sameScope(scope, { kind: "feed", id: feed.id });
    return (
      <div
        key={feed.id}
        role="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("cortex/feed", feed.id);
          e.dataTransfer.effectAllowed = "move";
          setDraggingFeed(true);
        }}
        onDragEnd={() => {
          setDraggingFeed(false);
          setDropTarget(null);
        }}
        onContextMenu={(e) => openMenu(e, feedMenu(feed))}
        onClick={() => setScope({ kind: "feed", id: feed.id })}
        title={feed.last_fetch_error ? `同步出错：${feed.last_fetch_error}` : undefined}
        className={cn(rowBase, "h-[30px] pl-7", rowState(active))}
      >
        <FeedIcon feed={feed} size={15} />
        <span className={cn("flex-1 truncate text-left", feed.unread_count === 0 && !active && "text-muted-foreground")}>
          {feed.title}
        </span>
        {feed.last_fetch_error && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-label="同步出错" />}
        <span className="group-hover:hidden">
          <Count value={feed.unread_count} active={active} />
        </span>
        <button
          aria-label="更多"
          className="hidden h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground group-hover:flex"
          onClick={(e) => openMenu(e, feedMenu(feed))}
        >
          <Icon name="more" className="h-4 w-4" />
        </button>
      </div>
    );
  };

  const groupHeader = (id: string, name: string, unread: number, category?: Category) => {
    const active = category ? sameScope(scope, { kind: "category", id: category.id }) : sameScope(scope, { kind: "uncategorized" });
    return (
      <div
        draggable={!!category && renamingId !== category.id}
        onDragStart={
          category
            ? (e) => {
                e.dataTransfer.setData("cortex/category", category.id);
                e.dataTransfer.effectAllowed = "move";
              }
            : undefined
        }
        onDragOver={(e) => onDragOver(e, id)}
        onDragLeave={() => setDropTarget((t) => (t === id ? null : t))}
        onDrop={(e) => onDrop(e, id)}
        onContextMenu={category ? (e) => openMenu(e, categoryMenu(category)) : undefined}
        className={cn(
          rowBase,
          "h-8 gap-1 pl-1",
          rowState(active),
          dropTarget === id && "bg-primary/10 ring-1 ring-inset ring-primary/40",
        )}
      >
        <button
          aria-label={collapsed[id] ? "展开" : "收起"}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          onClick={() => toggleCollapsed(id)}
        >
          <Icon name="chevron" className={cn("h-3 w-3 transition-transform duration-150", !collapsed[id] && "rotate-90")} />
        </button>
        {category && renamingId === category.id ? (
          <input
            autoFocus
            className="no-drag h-6 flex-1 rounded-md border border-ring/50 bg-background px-1.5 text-[13px] outline-none ring-[3px] ring-ring/15"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => void submitRename(category)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitRename(category);
              if (e.key === "Escape") setRenamingId(null);
            }}
          />
        ) : (
          <button
            className="flex-1 truncate text-left font-medium"
            onClick={() => setScope(category ? { kind: "category", id: category.id } : { kind: "uncategorized" })}
          >
            {name}
          </button>
        )}
        <span className={cn(category && "group-hover:hidden")}>
          <Count value={unread} active={active} />
        </span>
        {category && (
          <button
            aria-label="分类操作"
            className="hidden h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground group-hover:flex"
            onClick={(e) => openMenu(e, categoryMenu(category))}
          >
            <Icon name="more" className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  };

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-border/70 bg-sidebar">
      <div className="flex h-[52px] shrink-0 items-center justify-end gap-0.5 pl-20 pr-2.5" data-tauri-drag-region>
        <IconButton label="同步全部" shortcut="⌘R" disabled={syncing} onClick={() => void syncAll()}>
          <Icon name="refresh" className={cn("h-[17px] w-[17px]", syncing && "animate-spin")} />
        </IconButton>
        <IconButton label="添加订阅" shortcut="⌘N" onClick={onAddFeed}>
          <Icon name="plus" className="h-[18px] w-[18px]" />
        </IconButton>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 pb-4 pt-1">
        <div className="space-y-px">
          {navItem({ kind: "all" }, "全部文章", counts.unread, "inbox")}
          {navItem({ kind: "later" }, "稍后读", counts.later, "clock")}
          {navItem({ kind: "favorites" }, "收藏", counts.favorites, "star")}
        </div>

        <div>
          <div className="mb-1 flex h-6 items-center justify-between pl-2.5 pr-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">订阅</span>
            <IconButton label="新建分类" size="sm" tipAlign="end" className="h-6 w-6" onClick={() => setCreating(true)}>
              <Icon name="plus" className="h-3.5 w-3.5" />
            </IconButton>
          </div>

          <div className="space-y-0.5">
            {creating && (
              <input
                autoFocus
                placeholder="分类名称，回车确认"
                className="no-drag mb-1 h-8 w-full rounded-lg border border-ring/50 bg-background px-2.5 text-[13px] outline-none ring-[3px] ring-ring/15"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={() => void submitCreate()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitCreate();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                  }
                }}
              />
            )}

            {groups.list.map(({ category, feeds: items }) => (
              <div key={category.id}>
                {groupHeader(category.id, category.name, items.reduce((sum, f) => sum + f.unread_count, 0), category)}
                {!collapsed[category.id] && (
                  <div className="space-y-px">
                    {items.map(feedRow)}
                    {items.length === 0 && (
                      <div className="py-1.5 pl-9 text-[11.5px] text-muted-foreground/70">把订阅源拖到这里</div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {(groups.loose.length > 0 || draggingFeed) && (
              <div>
                {groupHeader(UNCATEGORIZED, "未分类", groups.loose.reduce((s, f) => s + f.unread_count, 0))}
                {!collapsed[UNCATEGORIZED] && <div className="space-y-px">{groups.loose.map(feedRow)}</div>}
              </div>
            )}

            {feeds.length === 0 && (
              <button
                onClick={onAddFeed}
                className="mt-2 flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-center text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <Icon name="rss" className="h-5 w-5" />
                <span className="text-xs leading-relaxed">添加第一个订阅源，<br />或在设置里导入 OPML</span>
              </button>
            )}
          </div>
        </div>
      </nav>

      <div className="flex h-11 shrink-0 items-center gap-1 border-t border-border/70 pl-3 pr-2">
        <button
          onClick={onOpenManager}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left text-[11.5px] text-muted-foreground hover:text-foreground"
        >
          {erroredFeeds > 0 ? (
            <>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
              <span className="truncate">{erroredFeeds} 个订阅源同步出错</span>
            </>
          ) : (
            <>
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", syncing ? "animate-pulse bg-primary" : "bg-success/70")} />
              <span className="truncate">
                {syncing ? "正在同步…" : lastSync ? `已同步 · ${relativeTime(lastSync.finished_at)}` : `${feeds.length} 个订阅源`}
              </span>
            </>
          )}
        </button>
        <IconButton label="订阅源管理" size="sm" tipSide="top" onClick={onOpenManager}>
          <Icon name="heartbeat" className="h-4 w-4" />
        </IconButton>
        <IconButton label="设置" shortcut="⌘," size="sm" tipSide="top" tipAlign="end" onClick={onOpenSettings}>
          <Icon name="settings" className="h-4 w-4" />
        </IconButton>
      </div>

      {menu && <Menu {...menu} onClose={() => setMenu(null)} />}

      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={`删除分类「${confirmDelete?.name ?? ""}」？`}
        description="分类里的订阅源会移到「未分类」，不会删除任何订阅或文章。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const target = confirmDelete!;
                setConfirmDelete(null);
                if (sameScope(scope, { kind: "category", id: target.id })) setScope({ kind: "all" });
                void run(() => api.deleteCategory(target.id));
              }}
            >
              删除分类
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </aside>
  );
}
