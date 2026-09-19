"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";
import { toolSceneRuntime } from "../scenes/runtime";
import { SOLID_CAPACITY_VERSION, type SolidCapacityInitial } from "./solid-capacity-contract";

const Workspace = dynamic(() => import("./SolidCapacityWorkspace").then((m) => m.SolidCapacityWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });
function Preparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof SOLID_CAPACITY_VERSION>) {
  const capture = useCallback((initial: SolidCapacityInitial | null) => onChange(initial ? {
    toolId: "solid-capacity", contentVersion: SOLID_CAPACITY_VERSION, payload: { title, initial },
  } : null), [title, onChange]);
  return <ToolPreparationStage version={SOLID_CAPACITY_VERSION} fullHeight={fullHeight}>
    <Workspace initial={existing?.payload.initial} onSnapshot={capture} />
  </ToolPreparationStage>;
}
export const solidCapacitySceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: SOLID_CAPACITY_VERSION, Preparation,
  Presentation: ({ scene, classroom }) => <Workspace initial={scene.payload.initial} readOnly={Boolean(classroom && !classroom.onChange)}
    classroom={toolSceneRuntime<typeof SOLID_CAPACITY_VERSION>(scene, classroom)} />,
});
