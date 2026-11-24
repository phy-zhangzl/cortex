import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage, type Feed, type FeedHealth } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Segmented } from "./ui/segmented";
import { IconButton } from "./ui/icon-button";
import { FeedIcon } from "./FeedIcon";
import { Icon } from "./Icon";
import { relativeTime } from "./ArticleList";

type Status = "error" | "dormant" | "slow" | "ok" | "new";

const DAY = 86_400_000;

export function feedStatus(feed: FeedHealth): Status {
  if (feed.fetch_error_count >= 3 || (feed.last_fetch_error && !feed.last_fetch_at)) return "error";
  if (!feed.latest_entry_at) {
    const age = feed.created_at ? Date.now() - new Date(feed.created_at).getTime() : Infinity;
    return age < 7 * DAY ? "new" : "dormant";
  }
  const idle = Date.now() - new Date(feed.latest_entry_at).getTime();
  if (idle > 90 * DAY) return "dormant";
  if (idle > 30 * DAY) return "slow";
  return "ok";
}

const STATUS: Record<Status, { label: string; className: string; rank: number }> = {
  error: { label: "同步失败", className: "bg-destructive/10 text-destructive", rank: 0 },
  dormant: { label: "已停更", className: "bg-muted text-muted-foreground", rank: 1 },
  slow: { label: "低频", className: "bg-warning/10 text-warning", rank: 2 },
  new: { label: "新添加", className: "bg-primary/10 text-primary", rank: 3 },
  ok: { label: "活跃", className: "bg-success/10 text-success", rank: 4 },
};

/** Subscription health: which feeds are failing, gone quiet, or worth keeping. */
export function FeedManager({ open, onClose, onEditFeed }: { open: boolean; onClose: () => void; onEditFeed: (feed: Feed) => void }) {
  const { categories, feeds, syncAll, syncing, toast, setScope } = useAppStore();
  const [rows, setRows] = useState<FeedHealth[]>([]);
  const [filter, setFilter] = useState<"attention" | "all">("attention");

  const load = useCallback(async () => {
    try {
      setRows(await api.feedHealth());
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }, [toast]);

  useEffect(() => {
    if (open) void load();
  }, [open, load, feeds]);

  const withStatus = useMemo(
    () =>
      rows
        .map((row) => ({ row, status: feedStatus(row) }))
        .sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank || a.row.title.localeCompare(b.row.title)),
    [rows],
  );
  const counts = useMemo(() => {
    const c: Record<Status, number> = { error: 0, dormant: 0, slow: 0, new: 0, ok: 0 };
    withStatus.forEach(({ status }) => (c[status] += 1));
    return c;
  }, [withStatus]);
  const needsAttention = counts.error + counts.dormant;
  const visible = filter === "attention" ? withStatus.filter(({ status }) => status === "error" || status === "dormant") : withStatus;

  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "未分类";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      className="max-w-3xl"
      title="订阅源管理"
      description="定期看看哪些源已经失效或停更，保持订阅列表精简。"
      footer={
        <>
          <span className="mr-auto text-[11.5px] text-muted-foreground">文章保留 30 天；收藏和稍后读的文章永久保留。</span>
          <Button variant="outline" disabled={syncing} onClick={() => void syncAll().then(load)}>
            <Icon name="refresh" className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
            全部重新检查
          </Button>
          <Button onClick={onClose}>完成</Button>
        </>
      }
    >
      <div className="mb-4 grid grid-cols-4 gap-2.5">
        {(
          [
            ["ok", "活跃", "近 30 天有更新"],
            ["slow", "低频", "30–90 天未更新"],
            ["dormant", "已停更", "超过 90 天未更新"],
            ["error", "同步失败", "连续多次抓取失败"],
          ] as const
        ).map(([key, label, hint]) => (
          <div key={key} className="rounded-xl border border-border bg-card px-3.5 py-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-semibold tabular-nums">{counts[key] + (key === "ok" ? counts.new : 0)}</span>
              <span className={cn("rounded-full px-1.5 py-px text-[10.5px] font-medium", STATUS[key].className)}>{label}</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>
          </div>
        ))}
      </div>

      <div className="mb-2 flex items-center justify-between">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "attention", label: `需要关注 ${needsAttention}` },
            { value: "all", label: `全部 ${rows.length}` },
          ]}
        />
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border py-10 text-center">
          <Icon name="check" className="mb-2 h-5 w-5 text-success" />
          <div className="text-[13px] font-medium">所有订阅源都很健康</div>
          <div className="mt-1 text-xs text-muted-foreground">没有失效或长期停更的源</div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="grid grid-cols-[minmax(0,1fr)_88px_92px_64px_76px] gap-3 border-b border-border bg-muted/50 px-3.5 py-2 text-[11px] font-medium text-muted-foreground">
            <span>订阅源</span>
            <span>状态</span>
            <span>最近更新</span>
            <span className="text-right">近 30 天</span>
            <span />
          </div>
          <div className="divide-y divide-border">
            {visible.map(({ row, status }) => {
              const feed = feeds.find((f) => f.id === row.id);
              return (
                <div key={row.id} className="group grid grid-cols-[minmax(0,1fr)_88px_92px_64px_76px] items-center gap-3 px-3.5 py-2.5 hover:bg-muted/40">
                  <button
                    className="flex min-w-0 items-center gap-2.5 text-left"
                    onClick={() => {
                      setScope({ kind: "feed", id: row.id });
                      onClose();
                    }}
                  >
                    <FeedIcon feed={row} size={18} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{row.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground" title={row.last_fetch_error ?? row.url}>
                        {status === "error" && row.last_fetch_error ? row.last_fetch_error : `${categoryName(row.category_id)} · ${row.url}`}
                      </span>
                    </span>
                  </button>
                  <span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS[status].className)}>{STATUS[status].label}</span>
                  </span>
                  <span className="text-[12px] text-muted-foreground">{row.latest_entry_at ? relativeTime(row.latest_entry_at) : "—"}</span>
                  <span className="text-right text-[12px] tabular-nums text-muted-foreground">{row.recent_count}</span>
                  <span className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <IconButton label="重新同步" size="sm" onClick={() => void syncAll([row.id]).then(load)}>
                      <Icon name="refresh" className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton label="编辑或删除" size="sm" tipAlign="end" disabled={!feed} onClick={() => feed && onEditFeed(feed)}>
                      <Icon name="edit" className="h-3.5 w-3.5" />
                    </IconButton>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Dialog>
  );
}
