import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import type { Feed } from "@/lib/api";
import { readPref, writePref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/Sidebar";
import { ArticleList } from "@/components/ArticleList";
import { Reader } from "@/components/Reader";
import { FeedDialog } from "@/components/FeedDialog";
import { SettingsDialog, type ThemeMode } from "@/components/SettingsDialog";
import { FeedManager } from "@/components/FeedManager";
import { Icon } from "@/components/Icon";
import { Kbd } from "@/components/ui/kbd";
import "highlight.js/styles/github.css";

function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(() => readPref<ThemeMode>("theme", "system"));
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return [
    theme,
    (mode: ThemeMode) => {
      writePref("theme", mode);
      setTheme(mode);
    },
  ] as const;
}

export default function App() {
  const {
    selectedId, refreshSidebar, loadArticles, syncAll, selectNeighbor, toggleFavorite, toggleReadLater,
    setRead, markScopeRead, articles, toasts, dismissToast,
  } = useAppStore();
  const [theme, setTheme] = useTheme();
  const [syncInterval, setSyncInterval] = useState<number>(() => readPref("sync-interval", 30));
  const [focusMode, setFocusMode] = useState(false);
  const [feedDialog, setFeedDialog] = useState<{ open: boolean; feed: Feed | null }>({ open: false, feed: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Startup: show what we have, then fetch what's new.
  useEffect(() => {
    void (async () => {
      await Promise.all([refreshSidebar(), loadArticles()]);
      await syncAll();
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!syncInterval) return;
    const timer = window.setInterval(() => void syncAll(), syncInterval * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [syncInterval, syncAll]);

  const dialogOpen = feedDialog.open || settingsOpen || managerOpen;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialogOpen) return;
      if (e.metaKey && e.key === "r") {
        e.preventDefault();
        void syncAll();
        return;
      }
      if (e.metaKey && e.key === "n") {
        e.preventDefault();
        setFeedDialog({ open: true, feed: null });
        return;
      }
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const current = articles.find((a) => a.id === selectedId);
      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          selectNeighbor(1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          selectNeighbor(-1);
          break;
        case "f":
          if (selectedId) void toggleFavorite(selectedId);
          break;
        case "l":
          if (selectedId) void toggleReadLater(selectedId);
          break;
        case "r":
          if (current) void setRead(current.id, !current.is_read);
          break;
        case "A":
          void markScopeRead();
          break;
        case "/":
          e.preventDefault();
          setFocusMode(false);
          setTimeout(() => searchRef.current?.focus(), 0);
          break;
        case "\\":
          setFocusMode((v) => !v);
          break;
        case "Escape":
          setFocusMode(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [articles, dialogOpen, markScopeRead, selectNeighbor, selectedId, setRead, syncAll, toggleFavorite, toggleReadLater]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {!focusMode && (
        <>
          <Sidebar
            onAddFeed={() => setFeedDialog({ open: true, feed: null })}
            onEditFeed={(feed) => setFeedDialog({ open: true, feed })}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenManager={() => setManagerOpen(true)}
          />
          <ArticleList ref={searchRef} />
        </>
      )}

      {selectedId ? (
        <Reader key="reader" articleId={selectedId} focusMode={focusMode} onToggleFocus={() => setFocusMode((v) => !v)} />
      ) : (
        <main className="flex flex-1 flex-col" data-tauri-drag-region>
          <div className="flex flex-1 flex-col items-center justify-center gap-6" data-tauri-drag-region>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Icon name="rss" className="h-6 w-6" />
            </div>
            <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-2.5 text-[12.5px] text-muted-foreground">
              {(
                [
                  [["J", "K"], "下一篇 / 上一篇"],
                  [["F"], "收藏并存档"],
                  [["L"], "稍后读"],
                  [["T"], "双语对照"],
                  [["S"], "AI 摘要"],
                  [["O"], "打开原文"],
                  [["/"], "搜索"],
                  [["\\"], "专注模式"],
                ] as const
              ).map(([keys, label]) => (
                <div key={label} className="contents">
                  <span className="flex justify-end gap-1">
                    {keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </main>
      )}

      <FeedDialog open={feedDialog.open} feed={feedDialog.feed} onClose={() => setFeedDialog({ open: false, feed: null })} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onThemeChange={setTheme}
        syncInterval={syncInterval}
        onSyncIntervalChange={(minutes) => {
          writePref("sync-interval", minutes);
          setSyncInterval(minutes);
        }}
      />

      <FeedManager
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        onEditFeed={(feed) => setFeedDialog({ open: true, feed })}
      />

      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => dismissToast(t.id)}
            className={cn(
              "pointer-events-auto flex max-w-md items-center gap-2 rounded-full py-2 pl-3 pr-4 text-[12.5px] font-medium shadow-pop animate-in fade-in-0 slide-in-from-bottom-2 duration-200",
              t.tone === "error" ? "bg-destructive text-destructive-foreground" : "bg-popover text-popover-foreground",
            )}
          >
            <Icon
              name={t.tone === "error" ? "alert" : t.tone === "success" ? "check" : "dot"}
              filled={t.tone === "info"}
              className={cn("h-3.5 w-3.5 shrink-0", t.tone === "success" && "text-success", t.tone === "info" && "h-2 w-2 text-primary")}
            />
            <span className="truncate">{t.message}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
