import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { buildOpml, parseSubscriptions } from "@/lib/opml";
import { useAppStore } from "@/store/useAppStore";
import { Dialog, SettingsGroup, SettingsRow, inputClass } from "./ui/dialog";
import { Button } from "./ui/button";
import { Segmented } from "./ui/segmented";
import { Kbd } from "./ui/kbd";
import { cn } from "@/lib/utils";

export type ThemeMode = "system" | "light" | "dark";

const selectClass =
  "no-drag h-8 rounded-lg border border-input bg-background pl-2.5 pr-7 text-[12.5px] shadow-sm outline-none focus:ring-[3px] focus:ring-ring/15";

export function SettingsDialog({
  open,
  onClose,
  theme,
  onThemeChange,
  syncInterval,
  onSyncIntervalChange,
}: {
  open: boolean;
  onClose: () => void;
  theme: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  syncInterval: number;
  onSyncIntervalChange: (minutes: number) => void;
}) {
  const { categories, feeds, refreshSidebar, loadArticles, toast, exportMarkdown, counts } = useAppStore();
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [targetLang, setTargetLang] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const testConnection = async (url = baseUrl) => {
    setStatus({ tone: "info", text: "正在连接…" });
    try {
      const list = await api.listLlmModels(url);
      setModels(list);
      setStatus({ tone: "ok", text: `已连接 · ${list.length} 个模型` });
    } catch (e) {
      setModels([]);
      setStatus({ tone: "error", text: errorMessage(e) });
    }
  };

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    api.getLlmConfig().then((config) => {
      setBaseUrl(config.base_url);
      setModel(config.model);
      setTargetLang(config.target_lang);
      void testConnection(config.base_url);
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true);
    try {
      await Promise.all([
        api.setSetting("llm_base_url", baseUrl.trim()),
        api.setSetting("llm_model", model.trim()),
        api.setSetting("llm_target_lang", targetLang.trim()),
      ]);
      toast("设置已保存", "success");
      onClose();
    } catch (e) {
      setStatus({ tone: "error", text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const exportOpml = async () => {
    try {
      const path = await api.exportOpml(buildOpml(categories, feeds));
      toast(`已导出到 ${path.split("/").slice(-2).join("/")}`, "success");
    } catch (e) {
      toast(`导出失败：${errorMessage(e)}`, "error");
    }
  };

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const result = await api.importFeeds(parseSubscriptions(await file.text()));
      await refreshSidebar();
      toast(`导入完成：新增 ${result.added}，跳过 ${result.skipped}`, "success");
      void useAppStore.getState().syncAll().then(loadArticles);
    } catch (err) {
      toast(`导入失败：${errorMessage(err)}`, "error");
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="设置"
      className="max-w-[34rem]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <SettingsGroup title="翻译与摘要 · Ollama">
          <div className="space-y-3 px-4 py-3.5">
            <div className="flex gap-2">
              <input className={inputClass} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434" />
              <Button variant="outline" className="h-9 shrink-0" onClick={() => void testConnection()}>
                测试连接
              </Button>
            </div>
            {status && (
              <div
                className={cn(
                  "flex items-center gap-1.5 text-[12px]",
                  status.tone === "ok" && "text-success",
                  status.tone === "error" && "text-destructive",
                  status.tone === "info" && "text-muted-foreground",
                )}
              >
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full bg-current", status.tone === "info" && "animate-pulse")} />
                <span className="line-clamp-2">{status.text}</span>
              </div>
            )}
          </div>
          <SettingsRow label="模型" hint="翻译和摘要共用">
            {models.length > 0 ? (
              <select className={cn(selectClass, "w-[13rem]")} value={model} onChange={(e) => setModel(e.target.value)}>
                {!models.includes(model) && <option value={model}>{model || "请选择"}</option>}
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input className={cn(inputClass, "h-8 w-[13rem]")} value={model} onChange={(e) => setModel(e.target.value)} placeholder="模型名称" />
            )}
          </SettingsRow>
          <SettingsRow label="译文语言">
            <input className={cn(inputClass, "h-8 w-[13rem]")} value={targetLang} onChange={(e) => setTargetLang(e.target.value)} />
          </SettingsRow>
          <SettingsRow
            label="查单词"
            hint={
              <>
                选中单词后按 <Kbd>⌃</Kbd> <Kbd>⌘</Kbd> <Kbd>D</Kbd> 调出 macOS 词典
              </>
            }
          />
        </SettingsGroup>

        <SettingsGroup title="阅读">
          <SettingsRow label="外观">
            <Segmented
              value={theme}
              onChange={onThemeChange}
              options={[
                { value: "system", label: "自动" },
                { value: "light", label: "浅色" },
                { value: "dark", label: "深色" },
              ]}
            />
          </SettingsRow>
          <SettingsRow label="自动同步" hint="启动时总会同步一次">
            <select className={cn(selectClass, "w-[13rem]")} value={syncInterval} onChange={(e) => onSyncIntervalChange(Number(e.target.value))}>
              <option value={0}>仅启动时</option>
              <option value={30}>每 30 分钟</option>
              <option value={60}>每小时</option>
              <option value={180}>每 3 小时</option>
            </select>
          </SettingsRow>
          <SettingsRow label="文章保留" hint="超过 30 天的文章自动清理，收藏和稍后读永久保留">
            <span className="text-[12.5px] text-muted-foreground">30 天</span>
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="数据">
          <SettingsRow label="订阅列表" hint="OPML 格式，也可以导入旧版 Cortex 的 JSON 备份">
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                导入
              </Button>
              <Button variant="outline" size="sm" onClick={() => void exportOpml()}>
                导出
              </Button>
            </div>
            <input ref={fileRef} type="file" accept=".opml,.xml,.json" className="hidden" onChange={(e) => void importFile(e)} />
          </SettingsRow>
          <SettingsRow label="收藏" hint={`导出 ${counts.favorites} 篇收藏为 Markdown（含图片），可直接放进 Obsidian`}>
            <Button variant="outline" size="sm" disabled={counts.favorites === 0} onClick={() => void exportMarkdown("favorites")}>
              导出 Markdown
            </Button>
          </SettingsRow>
        </SettingsGroup>
      </div>
    </Dialog>
  );
}
