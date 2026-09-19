"use client";

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CopyPlus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getToolSceneDefinition, TOOL_SCENE_DEFINITIONS } from "./registry";
import { freezeToolScene, parseToolScene, toolSceneCatalogId, type ToolScene, type ToolSceneVersion } from "./contract";
import { ToolSceneLibrary, type ToolScenePageHeader } from "./ToolSceneLibrary";
import { getToolWorkbenchAdapter } from "./workbench-registry";
import { ToolToolbarButton } from "../ToolToolbarButton";

interface EditorProps {
  version: ToolSceneVersion; existing?: ToolScene; onReady?: (scene: ToolScene | null) => void; fullHeight?: boolean;
  pageHeader?: ToolScenePageHeader;
}

/** 共用宿主负责场景生命周期，工具专属参数和选项由登记的接线提供。 */
export function ToolSceneEditor(props: EditorProps) {
  return <ToolSceneEditorSession key={props.version} {...props} />;
}

function ToolSceneEditorSession({ version, existing, onReady, fullHeight = false, pageHeader }: EditorProps) {
  const tools = useTranslations("tools.items");
  const t = useTranslations("tools.preparation");
  const definition = TOOL_SCENE_DEFINITIONS.find((item) => item.contentVersion === version)!;
  const [activeVersion, setActiveVersion] = useState(version);
  const [origin, setOrigin] = useState(existing);
  const [title, setTitle] = useState(existing?.payload.title ?? tools(`${definition.catalogId}.name`));
  const [generation, setGeneration] = useState(0);
  const [libraryEpoch, setLibraryEpoch] = useState(0);
  const [ready, setReady] = useState<ToolScene | null>(null);
  const adapter = getToolWorkbenchAdapter(activeVersion);
  const latest = getToolWorkbenchAdapter(getToolSceneDefinition(definition.catalogId)!.contentVersion);
  const capture = useCallback((scene: ToolScene | null) => { setReady(scene); onReady?.(scene); }, [onReady]);
  function open(scene: ToolScene, imported = false) {
    if (toolSceneCatalogId(scene) !== definition.catalogId) return;
    if (imported) setLibraryEpoch((n) => n + 1);
    capture(null); setActiveVersion(scene.contentVersion); setOrigin(scene); setTitle(scene.payload.title); setGeneration((n) => n + 1);
  }
  return <div className={fullHeight ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-2"}>
    <ToolSceneLibrary key={`library-${libraryEpoch}`} version={activeVersion} scene={ready} onOpen={open} pageHeader={pageHeader}
      title={<ToolSceneName key={`name-${generation}`} value={title} onChange={setTitle} />}>
      {adapter.Import && createElement(adapter.Import, { key: `import-${generation}`, onOpen: (scene: ToolScene) => open(scene, true) })}
      {activeVersion !== latest.contentVersion && latest.upgrade && <ToolToolbarButton icon={CopyPlus} label={t("upgradeCopy")} disabled={!ready}
        onClick={() => { const upgraded = ready && latest.upgrade?.(ready); if (upgraded) open(freezeToolScene(upgraded), true); }} />}
    </ToolSceneLibrary>
    <ToolSceneConfiguration key={`scene-${generation}`} version={activeVersion} existing={origin} title={title} onReady={capture} fullHeight={fullHeight} />
  </div>;
}

function ToolSceneName({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useTranslations("tools.preparation");
  const [draft, setDraft] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (draft === null && returnFocus.current) {
      container.current?.querySelector("button")?.focus();
      returnFocus.current = false;
    }
  }, [draft]);
  function finish(cancel = false) {
    if (!cancel && draft?.trim()) onChange(draft.trim());
    setDraft(null);
  }
  // 编辑与展示使用同一宽度，失焦确认时保存按钮保持原位。
  return <div ref={container} className="flex h-9 w-44 min-w-0 items-center" data-tool-scene-name>
    {draft === null ? <Button type="button" size="sm" variant="ghost" className="h-9 w-full justify-start rounded-md px-2 text-ink hover:bg-moon/30"
      aria-label={t("rename")} title={`${value} · ${t("rename")}`} onClick={() => setDraft(value)}>
      <span className="min-w-0 truncate">{value}</span><Pencil aria-hidden className="size-3 shrink-0 text-muted" />
    </Button> : <Input className="h-9 w-full" value={draft} maxLength={80} aria-label={t("name")} autoFocus
      onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDraft(event.target.value)} onBlur={() => finish()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault(); returnFocus.current = true; finish(event.key === "Escape");
        }
      }} />}
  </div>;
}

function ToolSceneConfiguration({ version, existing, title, onReady, fullHeight }: {
  version: ToolSceneVersion; existing?: ToolScene; title: string; onReady: (scene: ToolScene | null) => void; fullHeight: boolean;
}) {
  const t = useTranslations("tools.preparation");
  const definition = TOOL_SCENE_DEFINITIONS.find((item) => item.contentVersion === version)!;
  const adapter = getToolWorkbenchAdapter(version);
  const [candidate, setCandidate] = useState<unknown | null>(null);
  const prepared = useMemo(() => {
    if (candidate === null) return null;
    try {
      const scene = parseToolScene(candidate);
      return scene.toolId === definition.toolId && scene.contentVersion === version ? scene : null;
    } catch { return null; }
  }, [candidate, definition.toolId, version]);
  useEffect(() => { onReady(prepared); }, [onReady, prepared]);
  return <div className={fullHeight ? "relative flex min-h-0 flex-1 flex-col" : "relative"} aria-busy={candidate === null} data-tool-scene-configuration>
    {createElement(adapter.Preparation, { existing, title, fullHeight, onChange: setCandidate })}
    {candidate !== null && !prepared && <p className="absolute bottom-2 left-2 z-30 max-w-[calc(100%-1rem)] rounded-md bg-paper px-2 py-1 text-xs text-rose" role="alert">{t("invalid")}</p>}
  </div>;
}

export function ToolSceneSettings({ scene, onChange }: { scene: ToolScene; onChange: (scene: ToolScene) => void }) {
  const t = useTranslations("tools.preparation");
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState<ToolScene | null>(null);
  return <Dialog open={open} onOpenChange={(value) => { setReady(null); setOpen(value); }}>
    <DialogTrigger asChild><Button type="button" size="sm" variant="secondary">{t("edit")}</Button></DialogTrigger>
    <DialogContent className="max-h-[95dvh] w-[min(960px,95vw)] max-w-none overflow-y-auto sm:max-w-none">
      <DialogHeader><DialogTitle>{t("edit")}</DialogTitle><DialogDescription>{t("fixedHint")}</DialogDescription></DialogHeader>
      {open && <ToolSceneEditor version={scene.contentVersion} existing={scene} onReady={setReady} />}
      <DialogFooter><Button variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button disabled={!ready} onClick={() => { if (ready) { onChange(freezeToolScene(ready)); setOpen(false); } }}>{t("apply")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
