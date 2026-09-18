"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FolderOpen, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { createToolDraftStore, ToolDraftError, type ToolDraftSummary } from "./draft-store";
import type { ToolScene, ToolSceneVersion } from "./contract";
import { TOOL_SCENE_DEFINITIONS } from "./registry";

export function ToolSceneLibrary({ version, scene, onOpen }: { version: ToolSceneVersion; scene: ToolScene | null; onOpen: (scene: ToolScene) => void }) {
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
  return <div className="space-y-2 px-1" data-tool-scene-library>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => { setShow(!show); if (!show) void action(async () => setDrafts(await store.list())); }}><FolderOpen className="size-4" />{t("library")}</Button>
      <Button size="sm" variant="secondary" disabled={!scene || pending} onClick={() => save()}><Save className="size-4" />{t("save")}</Button>
      {current && <Button size="sm" variant="ghost" disabled={!scene || pending} onClick={() => save(true)}>{t("saveCopy")}</Button>}
      {scene && saved === JSON.stringify(scene) && <span className="text-xs text-muted" role="status">{t("saved")}</span>}
    </div>
    {error && <p role="alert" className="text-xs text-rose">{error}</p>}
    {show && <div className="flex items-center gap-2">
      <Select value={selected} onValueChange={setSelected} disabled={pending}>
        <SelectTrigger aria-label={t("library")}><SelectValue placeholder={t(items.length ? "choose" : "empty")} /></SelectTrigger>
        <SelectContent>{items.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · v{item.revision}</SelectItem>)}</SelectContent>
      </Select>
      <Button size="sm" disabled={!selected || pending} onClick={() => setConfirm(true)}>{t("open")}</Button>
    </div>}
    <AlertDialog open={confirm} onOpenChange={setConfirm}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("open")}</AlertDialogTitle><AlertDialogDescription>{t("replaceHint")}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => void action(async () => {
          const result = await store.read(selected);
          if (result.scene.contentVersion !== version) throw new ToolDraftError("invalid");
          onOpen(result.scene); setCurrent(result); setSaved(JSON.stringify(result.scene)); setShow(false);
        })}>{t("open")}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
