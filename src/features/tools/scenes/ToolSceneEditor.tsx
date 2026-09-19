"use client";

import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TOOL_SCENE_DEFINITIONS } from "./registry";
import { freezeToolScene, parseToolScene, type ToolScene, type ToolSceneVersion } from "./contract";
import { ToolSceneLibrary } from "./ToolSceneLibrary";
import { getToolWorkbenchAdapter } from "./workbench-registry";

interface EditorProps {
  version: ToolSceneVersion; existing?: ToolScene; onReady?: (scene: ToolScene | null) => void; fullHeight?: boolean;
}

/** 共用宿主负责场景生命周期，工具专属参数和选项由登记的接线提供。 */
export function ToolSceneEditor(props: EditorProps) {
  return <ToolSceneEditorSession key={props.version} {...props} />;
}

function ToolSceneEditorSession({ version, existing, onReady, fullHeight = false }: EditorProps) {
  const [origin, setOrigin] = useState(existing);
  const [generation, setGeneration] = useState(0);
  const [libraryEpoch, setLibraryEpoch] = useState(0);
  const [ready, setReady] = useState<ToolScene | null>(null);
  const adapter = getToolWorkbenchAdapter(version);
  const capture = useCallback((scene: ToolScene | null) => { setReady(scene); onReady?.(scene); }, [onReady]);
  function open(scene: ToolScene, imported = false) {
    if (scene.contentVersion !== version) return;
    if (imported) setLibraryEpoch((n) => n + 1);
    capture(null); setOrigin(scene); setGeneration((n) => n + 1);
  }
  return <div className={fullHeight ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-2"}>
    <ToolSceneLibrary key={`library-${libraryEpoch}`} version={version} scene={ready} onOpen={open} />
    {adapter.Import && createElement(adapter.Import, { key: `import-${generation}`, onOpen: (scene: ToolScene) => open(scene, true) })}
    <ToolSceneConfiguration key={`scene-${generation}`} version={version} existing={origin} onReady={capture} fullHeight={fullHeight} />
  </div>;
}

function ToolSceneConfiguration({ version, existing, onReady, fullHeight }: {
  version: ToolSceneVersion; existing?: ToolScene; onReady: (scene: ToolScene | null) => void; fullHeight: boolean;
}) {
  const t = useTranslations("tools.preparation");
  const tools = useTranslations("tools.items");
  const definition = TOOL_SCENE_DEFINITIONS.find((item) => item.contentVersion === version)!;
  const adapter = getToolWorkbenchAdapter(version);
  const [title, setTitle] = useState(existing?.payload.title ?? tools(`${definition.catalogId}.name`));
  const [candidate, setCandidate] = useState<unknown | null>(null);
  const prepared = useMemo(() => {
    if (candidate === null) return null;
    try {
      const scene = parseToolScene(candidate);
      return scene.toolId === definition.toolId && scene.contentVersion === version ? scene : null;
    } catch { return null; }
  }, [candidate, definition.toolId, version]);
  useEffect(() => { onReady(prepared); }, [onReady, prepared]);
  return <div className={fullHeight ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-2"}>
    <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} aria-label={t("name")} />
    {createElement(adapter.Preparation, { existing, title, fullHeight, onChange: setCandidate })}
    {!prepared && <p className="text-xs text-muted" role="status">{candidate === null ? t("wait") : t("invalid")}</p>}
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
