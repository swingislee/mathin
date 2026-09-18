"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CUBE_COURSEWARE_CONTENT_VERSION, CUBE_NET_COURSEWARE_VERSION, DICE_COURSEWARE_VERSION, TOOL_SCENE_DEFINITIONS } from "./registry";
import { FRACTION_COURSEWARE_VERSION, MOTION_COURSEWARE_VERSION, type FractionScene, type MotionScene } from "./numeric-teaching-content";
import { freezeToolScene, parseToolScene, type ToolScene, type ToolSceneVersion } from "./contract";
import type { CubeNetTeachingSnapshot, DiceTeachingSnapshot } from "../courseware/spatial-teaching-content";
import { cubeSessionScene, cubeSnapshotHistory, createCubeSession, type CubeWorkbenchSession } from "../spatial-lab/cube-structures-session";
import { CUBE_TOOLBAR_IDS } from "../spatial-lab/cube-structures-toolbar";
import { cubeCoursewarePayloadSchema } from "../courseware/cube-structures-content";
import { CubeDraftCoursewarePicker } from "@/features/teacher-microcourses/CubeDraftCoursewarePicker";
import { isToolScene } from "./contract";
import { ToolSceneLibrary } from "./ToolSceneLibrary";

const loading = () => <Skeleton className="size-full" />;
const Dice = dynamic(() => import("../spatial-lab/DiceTeachingWorkspace"), { ssr: false, loading });
const Net = dynamic(() => import("../spatial-lab/CubeNetFoldWorkspace").then((m) => m.CubeNetFoldWorkspace), { ssr: false, loading });
const Cube = dynamic(() => import("../courseware/CubeStructuresCourseware").then((m) => m.CubeStructuresCourseware), { ssr: false, loading });
const Fraction = dynamic(() => import("../fraction-line/FractionLine").then((m) => m.FractionLine), { ssr: false, loading });
const Motion = dynamic(() => import("../motion-lab/MotionLab").then((m) => m.MotionLab), { ssr: false, loading });

/** 只接线，不重做工具：独立工具页和课件编辑器使用同一个备课宿主。 */
export function ToolSceneEditor({ version, existing, onReady, fullHeight = false }: {
  version: ToolSceneVersion; existing?: ToolScene; onReady?: (scene: ToolScene | null) => void; fullHeight?: boolean;
}) {
  const t = useTranslations("tools.preparation");
  const [origin, setOrigin] = useState(existing);
  const [generation, setGeneration] = useState(0);
  const [libraryEpoch, setLibraryEpoch] = useState(0);
  const [ready, setReady] = useState<ToolScene | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [legacyScene, setLegacyScene] = useState<ToolScene | null>(null);
  const capture = useCallback((scene: ToolScene | null) => { setReady(scene); onReady?.(scene); }, [onReady]);
  const setLegacySceneFromCube = useCallback((scene: Parameters<typeof isToolScene>[0] | null) => {
    setLegacyScene(scene && isToolScene(scene) ? scene : null);
  }, []);
  function open(scene: ToolScene, imported = false) {
    if (scene.contentVersion !== version) return;
    if (imported) setLibraryEpoch((n) => n + 1);
    capture(null); setOrigin(scene); setLegacy(false); setGeneration((n) => n + 1);
  }
  return <div className={fullHeight ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-2"}>
    <ToolSceneLibrary key={`library-${libraryEpoch}`} version={version} scene={ready} onOpen={open} />
    {version === CUBE_COURSEWARE_CONTENT_VERSION && <div>
      <Button size="sm" variant="ghost" onClick={() => { setLegacy(!legacy); setLegacyScene(null); }}>{t("legacyCube")}</Button>
      {legacy && <div className="space-y-2">
        <CubeDraftCoursewarePicker onReady={setLegacySceneFromCube} />
        <Button size="sm" disabled={!legacyScene} onClick={() => { if (legacyScene) open(legacyScene, true); }}>{t("open")}</Button>
      </div>}
    </div>}
    <ToolSceneConfiguration key={`scene-${generation}`} version={version} existing={origin} onReady={capture} fullHeight={fullHeight} />
  </div>;

}

function ToolSceneConfiguration({ version, existing, onReady, fullHeight }: {
  version: ToolSceneVersion; existing?: ToolScene; onReady: (scene: ToolScene | null) => void; fullHeight: boolean;
}) {
  const t = useTranslations("tools.preparation");
  const tools = useTranslations("tools.items");
  const locale = useLocale() === "en" ? "en" : "zh";
  const definition = TOOL_SCENE_DEFINITIONS.find((item) => item.contentVersion === version)!;
  const [origin] = useState(existing);
  const [title, setTitle] = useState(existing?.payload.title ?? tools(`${definition.catalogId}.name`));
  const [snapshot, setSnapshot] = useState<unknown>(null);
  const [useRecording, setUseRecording] = useState(existing?.contentVersion === CUBE_COURSEWARE_CONTENT_VERSION && existing.payload.history.operations.length > 0);
  const initialCube = useMemo(() => origin?.contentVersion === CUBE_COURSEWARE_CONTENT_VERSION ? origin.payload
    : cubeCoursewarePayloadSchema.parse({ title: "Cube", history: createCubeSession([{ x: 0, y: 0, z: 0 }]).work, toolbar: [...CUBE_TOOLBAR_IDS] }), [origin]);
  const captureCube = useCallback((session: CubeWorkbenchSession | null) => {
    setSnapshot(session ? { ...initialCube, history: useRecording ? initialCube.history : cubeSnapshotHistory(cubeSessionScene(session)) } : null);
  }, [initialCube, useRecording]);
  const captureNet = useCallback((scene: CubeNetTeachingSnapshot | null) => setSnapshot(scene), []);
  const captureDice = useCallback((scene: DiceTeachingSnapshot | null) => setSnapshot(scene), []);
  const captureFraction = useCallback((scene: FractionScene | null) => setSnapshot(scene), []);
  const captureMotion = useCallback((scene: MotionScene | null) => setSnapshot(scene), []);
  const prepared = useMemo(() => {
    if (!snapshot) return null;
    try {
      return parseToolScene({ toolId: definition.toolId, contentVersion: version,
        payload: version === CUBE_COURSEWARE_CONTENT_VERSION ? { ...snapshot as object, title } : { title, initial: snapshot } });
    } catch { return null; }
  }, [definition.toolId, snapshot, title, version]);
  useEffect(() => { onReady(prepared); }, [onReady, prepared]);
  return <div className={fullHeight ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-2"}>
    <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} aria-label={t("name")} />
    {initialCube.history.operations.length > 0 && version === CUBE_COURSEWARE_CONTENT_VERSION && <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" aria-pressed={useRecording} onClick={() => setUseRecording(true)}>{t("keepRecording")}</Button>
      <Button size="sm" variant="secondary" aria-pressed={!useRecording} onClick={() => setUseRecording(false)}>{t("useCurrent")}</Button>
      <p className="w-full text-xs text-muted">{t("recordingHint")}</p>
    </div>}
    <div className={fullHeight ? "flex min-h-0 flex-1" : "flex aspect-[4/3] min-h-0 w-full"} data-tool-scene-editor={version}>
      {version === CUBE_COURSEWARE_CONTENT_VERSION && <Cube payload={initialCube} preview preparation onSnapshot={captureCube} />}
      {version === CUBE_NET_COURSEWARE_VERSION && <Net locale={locale} initial={origin?.contentVersion === version ? origin.payload.initial : undefined} onSnapshot={captureNet} courseware />}
      {version === DICE_COURSEWARE_VERSION && <Dice locale={locale} initial={origin?.contentVersion === version ? origin.payload.initial : undefined} onSnapshot={captureDice} courseware />}
      {version === FRACTION_COURSEWARE_VERSION && <Fraction embedded initial={origin?.contentVersion === version ? origin.payload.initial : undefined} onSnapshot={captureFraction} />}
      {version === MOTION_COURSEWARE_VERSION && <Motion embedded initial={origin?.contentVersion === version ? origin.payload.initial : undefined} onSnapshot={captureMotion} preparation />}
    </div>
    {!prepared && <p className="text-xs text-muted" role="status">{snapshot ? t("invalid") : t("wait")}</p>}
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
