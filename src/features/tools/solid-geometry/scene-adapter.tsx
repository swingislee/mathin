"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";
import { toolSceneRuntime } from "../scenes/runtime";
import { SOLID_GEOMETRY_VERSION, type SolidGeometryInitial } from "./solid-geometry-contract";

const Workspace = dynamic(() => import("./SolidGeometryWorkspace").then((m) => m.SolidGeometryWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });
function Preparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof SOLID_GEOMETRY_VERSION>) {
  const capture = useCallback((initial: SolidGeometryInitial | null) => onChange(initial ? {
    toolId: "solid-geometry", contentVersion: SOLID_GEOMETRY_VERSION, payload: { title, initial },
  } : null), [title, onChange]);
  return <ToolPreparationStage version={SOLID_GEOMETRY_VERSION} fullHeight={fullHeight}>
    <Workspace initial={existing?.payload.initial} onSnapshot={capture} />
  </ToolPreparationStage>;
}
export const solidGeometrySceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: SOLID_GEOMETRY_VERSION, Preparation,
  Presentation: ({ scene, classroom }) => <Workspace initial={scene.payload.initial} readOnly={Boolean(classroom && !classroom.onChange)}
    classroom={toolSceneRuntime<typeof SOLID_GEOMETRY_VERSION>(scene, classroom)} />,
});
