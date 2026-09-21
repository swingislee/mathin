"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";
import { toolSceneRuntime } from "../scenes/runtime";
import { SOLID_NETS_LESSON_VERSION, type SolidNetsTeachingSnapshot } from "./contract";

const Workspace = dynamic(() => import("./SolidNetsTool").then((m) => m.SolidNetsTool), { ssr: false, loading: () => <Skeleton className="size-full" /> });
function Preparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof SOLID_NETS_LESSON_VERSION>) {
  const capture = useCallback((initial: SolidNetsTeachingSnapshot | null) => onChange(initial ? {
    toolId: "solid-nets", contentVersion: SOLID_NETS_LESSON_VERSION, payload: { title, initial },
  } : null), [title, onChange]);
  return <ToolPreparationStage version={SOLID_NETS_LESSON_VERSION} fullHeight={fullHeight}>
    <Workspace initial={existing?.payload.initial} onSnapshot={capture} />
  </ToolPreparationStage>;
}
export const solidNetsSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: SOLID_NETS_LESSON_VERSION, Preparation,
  Presentation: ({ scene, classroom }) => <Workspace initial={scene.payload.initial} readOnly={Boolean(classroom && !classroom.onChange)}
    runtime={toolSceneRuntime<typeof SOLID_NETS_LESSON_VERSION>(scene, classroom)} />,
});
