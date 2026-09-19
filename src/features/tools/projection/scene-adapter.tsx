"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";
import { toolSceneRuntime } from "../scenes/runtime";
import { PROJECTION_COURSEWARE_VERSION, type ProjectionInitial } from "./projection-contract";

const Workspace = dynamic(() => import("./ProjectionWorkspace").then((m) => m.ProjectionWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });
function Preparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof PROJECTION_COURSEWARE_VERSION>) {
  const capture = useCallback((initial: ProjectionInitial | null) => onChange(initial ? {
    toolId: "projection", contentVersion: PROJECTION_COURSEWARE_VERSION, payload: { title, initial },
  } : null), [title, onChange]);
  return <ToolPreparationStage version={PROJECTION_COURSEWARE_VERSION} fullHeight={fullHeight}>
    <Workspace initial={existing?.payload.initial} onSnapshot={capture} />
  </ToolPreparationStage>;
}
export const projectionSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: PROJECTION_COURSEWARE_VERSION, Preparation,
  Presentation: ({ scene, classroom }) => <Workspace initial={scene.payload.initial} readOnly={!classroom?.onChange}
    classroom={toolSceneRuntime<typeof PROJECTION_COURSEWARE_VERSION>(scene, classroom)} />,
});
