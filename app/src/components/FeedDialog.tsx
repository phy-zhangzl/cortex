import { useEffect, useState } from "react";
import { api, errorMessage, type Feed } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";
import { Dialog, Field, inputClass } from "./ui/dialog";
import { Button } from "./ui/button";

const NEW_CATEGORY = "__new__";

/** Add a feed (paste a site or feed URL; the feed is discovered) or edit an existing one. */
export function FeedDialog({ open, feed, onClose }: { open: boolean; feed: Feed | null; onClose: () => void }) {
  const { categories, refreshSidebar, setScope, scope, toast, loadArticles } = useAppStore();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string>("");
  const [newCategory, setNewCategory] = useState("");
  const [discovered, setDiscovered] = useState(false);
  const [busy, setBusy] = useState<null | "discover" | "save" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl(feed?.url ?? "");
    setTitle(feed?.title ?? "");
    setSiteUrl(feed?.site_url ?? null);
    setCategoryId(feed?.category_id ?? (scope.kind === "category" ? scope.id : ""));
    setNewCategory("");
    setDiscovered(!!feed);
    setError(null);
    setBusy(null);
    setConfirmingDelete(false);
  }, [open, feed]); // eslint-disable-line react-hooks/exhaustive-deps

  const discover = async () => {
    if (!url.trim()) return;
    setBusy("discover");
    setError(null);
    try {
      const result = await api.discoverFeed(url);
      setUrl(result.url);
      setTitle((t) => (feed && t ? t : result.title));
      setSiteUrl(result.site_url);
      setDiscovered(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const resolveCategory = async (): Promise<string | null> => {
    if (categoryId === NEW_CATEGORY) {
      const name = newCategory.trim();
      if (!name) return null;
      return (await api.createCategory(name)).id;
    }
    return categoryId || null;
  };

  const save = async () => {
    if (!discovered && !feed) return discover();
    setBusy("save");
    setError(null);
    try {
      const category = await resolveCategory();
      if (feed) {
        await api.updateFeed({ feedId: feed.id, title: title.trim(), url: url.trim(), categoryId: category });
      } else {
        const created = await api.createFeed({ title: title.trim(), url: url.trim(), siteUrl, categoryId: category });
        setScope({ kind: "feed", id: created.id });
      }
      await refreshSidebar();
      if (feed) await loadArticles();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!feed) return;
    setBusy("delete");
    try {
      const kept = await api.deleteFeed(feed.id);
      if (scope.kind === "feed" && scope.id === feed.id) setScope({ kind: "all" });
      await refreshSidebar();
      toast(kept > 0 ? `已删除订阅源，${kept} 篇收藏保留在「收藏」里` : "已删除订阅源");
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={feed ? "编辑订阅源" : "添加订阅"}
      description={feed ? undefined : "可以直接粘贴博客首页，会自动找到它的 RSS / Atom 地址。"}
      footer={
        <>
          {feed && (
            <Button
              variant={confirmingDelete ? "destructive" : "ghost-destructive"}
              className="mr-auto"
              disabled={!!busy}
              onClick={() => (confirmingDelete ? void remove() : setConfirmingDelete(true))}
            >
              {confirmingDelete ? "确认删除" : "删除订阅源"}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!!busy || !url.trim()} onClick={() => void save()}>
            {busy === "discover" ? "识别中…" : busy === "save" ? "保存中…" : !discovered && !feed ? "识别" : "保存"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="网站或订阅地址">
          <input
            autoFocus
            className={inputClass}
            placeholder="https://example.com 或 https://example.com/feed.xml"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (!feed) setDiscovered(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && void save()}
          />
        </Field>

        {(discovered || feed) && (
          <>
            <Field label="名称">
              <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="分类">
              <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">未分类</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value={NEW_CATEGORY}>+ 新建分类…</option>
              </select>
            </Field>
            {categoryId === NEW_CATEGORY && (
              <Field label="新分类名称">
                <input className={inputClass} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
              </Field>
            )}
          </>
        )}

        {confirmingDelete && (
          <p className="rounded-lg bg-destructive/[0.07] px-3 py-2.5 text-[12px] leading-relaxed text-destructive">
            删除后这个订阅源的文章会一并清理；收藏和稍后读的文章会保留。再点一次「确认删除」。
          </p>
        )}
        {error && (
          <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-destructive">
            <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
