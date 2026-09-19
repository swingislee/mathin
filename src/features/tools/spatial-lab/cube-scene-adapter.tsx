"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Import } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToolToolbarButton } from "../ToolToolbarButton";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cubeCoursewarePayloadSchema, cubeCoursewareV3ToolSchema } from "../courseware/cube-structures-content";
import { CUBE_COURSEWARE_CONTENT_VERSION, CUBE_ROTATION_COURSEWARE_VERSION } from "../scenes/registry";
import { isToolScene, type ToolScene } from "../scenes/contract";
import { toolSceneRuntime } from "../scenes/runtime";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps, type ToolSceneImportProps } from "../scenes/workbench-adapter";
import { cubeSessionScene, cubeSnapshotHistory, createCubeSession, type CubeWorkbenchSession } from "./cube-structures-session";
import { CUBE_TOOLBAR_IDS } from "./cube-structures-toolbar";

const Cube = dynamic(() => import("../courseware/CubeStructuresCourseware").then((m) => m.CubeStructuresCourseware), { ssr: false, loading: () => <Skeleton className="size-full" /> });
const CubeDraftCoursewarePicker = dynamic(() => import("@/features/teacher-microcourses/CubeDraftCoursewarePicker").then((m) => m.CubeDraftCoursewarePicker), { ssr: false });

/** 旧草稿和步骤录制属于立方体自身能力，共用备课宿主只提供导入槽。 */
function CubeSceneImport({ onOpen, rotation = false }: ToolSceneImportProps & { rotation?: boolean }) {
  const t = useTranslations("tools.preparation");
  const [open, setOpen] = useState(false);
  const [scene, setScene] = useState<ToolScene | null>(null);
  const capture = useCallback((value: Parameters<typeof isToolScene>[0] | null) => {
    setScene(value && isToolScene(value) && (value.contentVersion === CUBE_COURSEWARE_CONTENT_VERSION || value.contentVersion === CUBE_ROTATION_COURSEWARE_VERSION)
      ? rotation ? cubeCoursewareV3ToolSchema.parse({ ...value, contentVersion: CUBE_ROTATION_COURSEWARE_VERSION }) : value : null);
  }, [rotation]);
  return <Popover open={open} onOpenChange={(value) => { setOpen(value); setScene(null); }}>
    <PopoverTrigger asChild><ToolToolbarButton icon={Import} label={t("legacyCube")} /></PopoverTrigger>
    <PopoverContent align="start" className="max-h-[70dvh] w-[min(640px,90vw)] space-y-2 overflow-y-auto" aria-label={t("legacyCube")}>
      {open && <CubeDraftCoursewarePicker onReady={capture} />}
      <Button size="sm" disabled={!scene} onClick={() => { if (scene) { onOpen(scene); setOpen(false); } }}>{t("open")}</Button>
    </PopoverContent>
  </Popover>;
}

function CubePreparation({ existing, title, fullHeight, onChange, version }: ToolPreparationProps<typeof CUBE_COURSEWARE_CONTENT_VERSION | typeof CUBE_ROTATION_COURSEWARE_VERSION> & {
  version: typeof CUBE_COURSEWARE_CONTENT_VERSION | typeof CUBE_ROTATION_COURSEWARE_VERSION;
}) {
  const t = useTranslations("tools.preparation");
  const [useRecording, setUseRecording] = useState(!!existing?.payload.history.operations.length);
  const initial = useMemo(() => existing?.payload ?? cubeCoursewarePayloadSchema.parse({
    title: "Cube", history: createCubeSession([{ x: 0, y: 0, z: 0 }]).work, toolbar: [...CUBE_TOOLBAR_IDS],
  }), [existing]);
  const [session, setSession] = useState<CubeWorkbenchSession | null>(null);
  const candidate = useMemo(() => session ? {
    toolId: "spatial-lab", contentVersion: version,
    payload: { ...initial, title, history: useRecording ? initial.history : cubeSnapshotHistory(cubeSessionScene(session)) },
  } : null, [initial, session, title, useRecording, version]);
  useEffect(() => { onChange(candidate); }, [onChange, candidate]);
  return <ToolPreparationStage version={version} fullHeight={fullHeight} controls={
    initial.history.operations.length > 0 && <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" aria-pressed={useRecording} onClick={() => setUseRecording(true)}>{t("keepRecording")}</Button>
      <Button size="sm" variant="secondary" aria-pressed={!useRecording} onClick={() => setUseRecording(false)}>{t("useCurrent")}</Button>
      <p className="w-full text-xs text-muted">{t("recordingHint")}</p>
    </div>
  }>
    <Cube payload={initial} preview preparation allowRotation={version === CUBE_ROTATION_COURSEWARE_VERSION} onSnapshot={setSession} />
  </ToolPreparationStage>;
}

export const cubeSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: CUBE_COURSEWARE_CONTENT_VERSION, Preparation: (props) => <CubePreparation {...props} version={CUBE_COURSEWARE_CONTENT_VERSION} />, Import: CubeSceneImport,
  Presentation: ({ scene, classroom }) => <Cube payload={scene.payload} classroom={toolSceneRuntime<typeof CUBE_COURSEWARE_CONTENT_VERSION>(scene, classroom)} />,
});

export const cubeRotationSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: CUBE_ROTATION_COURSEWARE_VERSION,
  Preparation: (props) => <CubePreparation {...props} version={CUBE_ROTATION_COURSEWARE_VERSION} />,
  Import: (props) => <CubeSceneImport {...props} rotation />,
  Presentation: ({ scene, classroom }) => <Cube payload={scene.payload} allowRotation classroom={toolSceneRuntime<typeof CUBE_ROTATION_COURSEWARE_VERSION>(scene, classroom)} />,
  upgrade: (scene) => scene.contentVersion === CUBE_COURSEWARE_CONTENT_VERSION
    ? cubeCoursewareV3ToolSchema.parse({ ...scene, contentVersion: CUBE_ROTATION_COURSEWARE_VERSION }) : null,
});
