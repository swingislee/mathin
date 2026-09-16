"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CUBE_NET_COURSEWARE_VERSION, DICE_COURSEWARE_VERSION } from "@/features/tools/courseware/registry";
import { spatialTeachingToolSchema, type CubeNetTeachingSnapshot, type DiceTeachingSnapshot, type SpatialTeachingTool } from "@/features/tools/courseware/spatial-teaching-content";

const DiceWorkspace = dynamic(() => import("@/features/tools/spatial-lab/DiceTeachingWorkspace"), { ssr: false, loading: () => <Skeleton className="size-full" /> });
const NetWorkspace = dynamic(() => import("@/features/tools/spatial-lab/CubeNetFoldWorkspace").then((module) => module.CubeNetFoldWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });
export type SpatialTeachingVersion = typeof CUBE_NET_COURSEWARE_VERSION | typeof DICE_COURSEWARE_VERSION;

/** 配置窗口直接使用已有工作台；应用时复制当前完整起点，不保存预览进度。 */
export function SpatialTeachingContentEditor({ version, existing, onReady }: {
  version: SpatialTeachingVersion; existing?: SpatialTeachingTool; onReady: (tool: SpatialTeachingTool | null) => void;
}) {
  const t = useTranslations("teacherMicrocourses");
  const locale = useLocale() === "en" ? "en" : "zh";
  const [origin] = useState(existing);
  const [title, setTitle] = useState(existing?.payload.title ?? t(version === DICE_COURSEWARE_VERSION ? "diceComponent" : "cubeNetComponent"));
  const [snapshot, setSnapshot] = useState<CubeNetTeachingSnapshot | DiceTeachingSnapshot | null>(null);
  const captureDice = useCallback((value: DiceTeachingSnapshot | null) => setSnapshot(value), []);
  const captureNet = useCallback((value: CubeNetTeachingSnapshot | null) => setSnapshot(value), []);
  useEffect(() => {
    const result = spatialTeachingToolSchema.safeParse({ toolId: "spatial-lab", contentVersion: version, payload: { title, initial: snapshot } });
    onReady(result.success ? result.data : null);
  }, [onReady, snapshot, title, version]);
  return <div className="space-y-2">
    <Input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} aria-label={t("spatialComponentName")} />
    <p className="text-xs text-muted">{t("spatialComponentHint")}</p>
    <div className="flex aspect-[4/3] min-h-0 w-full" data-spatial-content-editor>
      {version === DICE_COURSEWARE_VERSION
        ? <DiceWorkspace locale={locale} initial={origin?.contentVersion === DICE_COURSEWARE_VERSION ? origin.payload.initial : undefined} onSnapshot={captureDice} courseware />
        : <NetWorkspace locale={locale} initial={origin?.contentVersion === CUBE_NET_COURSEWARE_VERSION ? origin.payload.initial : undefined} onSnapshot={captureNet} courseware />}
    </div>
    {!snapshot && <p className="text-xs text-muted" role="status">{t("spatialComponentWait")}</p>}
  </div>;
}

export function SpatialTeachingSettings({ tool, onChange }: { tool: SpatialTeachingTool; onChange: (tool: SpatialTeachingTool) => void }) {
  const t = useTranslations("teacherMicrocourses");
  const [open, setOpen] = useState(false);
  const [prepared, setPrepared] = useState<SpatialTeachingTool | null>(null);
  return <Dialog open={open} onOpenChange={(value) => { setPrepared(null); setOpen(value); }}>
    <DialogTrigger asChild><Button type="button" variant="secondary" size="sm">{t("spatialComponentEdit")}</Button></DialogTrigger>
    <DialogContent className="max-h-[95dvh] w-[min(960px,95vw)] max-w-none overflow-y-auto sm:max-w-none">
      <DialogHeader><DialogTitle>{t("spatialComponentEdit")}</DialogTitle><DialogDescription>{t("spatialComponentFixedHint")}</DialogDescription></DialogHeader>
      {open && <SpatialTeachingContentEditor version={tool.contentVersion} existing={tool} onReady={setPrepared} />}
      <DialogFooter><Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button type="button" disabled={!prepared} onClick={() => { if (prepared) { onChange(prepared); setOpen(false); } }}>{t("cubeToolbarApply")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
