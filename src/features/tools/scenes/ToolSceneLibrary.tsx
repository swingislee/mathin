"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CopyPlus, FolderInput, FolderOpen, Save } from "lucide-react";
import { ToolToolbarButton } from "../ToolToolbarButton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { createToolDraftStore, ToolDraftError, type ToolDraftSummary } from "./draft-store";
import { toolSceneCatalogId, type ToolScene, type ToolSceneVersion } from "./contract";
import { TOOL_SCENE_DEFINITIONS } from "./registry";
import { cn } from "@/lib/utils";

export interface ToolScenePageHeader { start: ReactNode; end: ReactNode }

export function ToolSceneLibrary({ version, scene, onOpen, title, pageHeader, children }: {
  version: ToolSceneVersion; scene: ToolScene | null; onOpen: (scene: ToolScene) => void;
  title: ReactNode; pageHeader?: ToolScenePageHeader; children?: ReactNode;
}) {
  const t = useTranslations("tools.preparation");
  const locale = useLocale() === "en" ? "en" : "zh";
  const store = useMemo(() => createToolDraftStore({ locale }), [locale]);
  const [drafts, setDrafts] = useState<ToolDraftSummary[] | null>(null);
  const [current, setCurrent] = useState<ToolDraftSummary | undefined>();
  const [selected, setSelected] = useState("");
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    let active = true;
    store.list().then((items) => { if (active) setDrafts(items); }).catch(() => { /* 自由试用不要求登录，保存时说明原因。 */ });
    return () => { active = false; };
  }, [store]);
  async function action(run: () => Promise<void>) {
    if (pending) return;
    setPending(true); setError("");
    try { await run(); } catch (err) { setError(t(`errors.${err instanceof ToolDraftError ? err.code : "unavailable"}`)); }
    finally { setPending(false); }
  }
  function save(copy = false) {
    if (!scene) return;
    void action(async () => {
      if (!drafts) await store.list();
      const result = await store.save(scene, copy ? undefined : current);
      setCurrent(result); setSaved(JSON.stringify(scene)); setDrafts(await store.list());
    });
  }
  const catalogId = TOOL_SCENE_DEFINITIONS.find((item) => item.contentVersion === version)?.catalogId;
  const items = drafts?.filter((item) => item.catalogId === catalogId) ?? [];
  return <div className={cn("@container/tool-toolbar relative min-w-0 shrink-0", pageHeader && "border-b")} data-tool-scene-library>
    {/* 固定单行高度，横向滚动条、保存状态与场景选择的显隐均不改变舞台高度。 */}
    <div className={cn("flex h-12 min-w-0 flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden [scrollbar-width:thin]", pageHeader ? "px-2 @2xl/tool-toolbar:px-4" : "px-1")} data-tool-scene-toolbar>
      {pageHeader?.start}
      {title}
      {scene && saved === JSON.stringify(scene) && <span className="sr-only shrink-0 whitespace-nowrap text-xs text-muted @5xl/tool-toolbar:not-sr-only" role="status">{t("saved")}</span>}
      <div className="ml-auto flex shrink-0 items-center gap-2" data-tool-scene-actions>
        <ToolToolbarButton icon={FolderOpen} label={t("library")} disabled={pending} aria-expanded={show} onClick={() => { setShow(!show); if (!show) void action(async () => setDrafts(await store.list())); }} />
        <ToolToolbarButton icon={Save} label={t("save")} disabled={!scene || pending} onClick={() => save()} />
        {current && <ToolToolbarButton icon={CopyPlus} label={t("saveCopy")} disabled={!scene || pending} onClick={() => save(true)} />}
        {show && <div className="flex shrink-0 items-center gap-2">
          <Select value={selected} onValueChange={setSelected} disabled={pending}>
            <SelectTrigger className="h-8 w-40 @5xl/tool-toolbar:w-56" aria-label={t("library")}><SelectValue placeholder={t(items.length ? "choose" : "empty")} /></SelectTrigger>
            <SelectContent>{items.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · v{item.revision}</SelectItem>)}</SelectContent>
          </Select>
          <ToolToolbarButton icon={FolderInput} label={t("open")} disabled={!selected || pending} onClick={() => setConfirm(true)} />
        </div>}
        {children}
        {pageHeader?.end}
      </div>
    </div>
    {error && <p role="alert" className="absolute left-1 top-full z-30 max-w-full rounded-md bg-paper px-2 py-1 text-xs text-rose shadow-sm">{error}</p>}
    <AlertDialog open={confirm} onOpenChange={setConfirm}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("open")}</AlertDialogTitle><AlertDialogDescription>{t("replaceHint")}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => void action(async () => {
          const result = await store.read(selected);
          if (toolSceneCatalogId(result.scene) !== catalogId) throw new ToolDraftError("invalid");
          onOpen(result.scene); setCurrent(result); setSaved(JSON.stringify(result.scene)); setShow(false);
        })}>{t("open")}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
