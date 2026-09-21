"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";
import { toolSceneRuntime } from "../scenes/runtime";
import { SOLID_REVOLUTION_VERSION, type SolidRevolutionInitial } from "./contract";

const Workspace = dynamic(() => import("./SolidRevolutionWorkspace").then((module) => module.SolidRevolutionWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });
function Preparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof SOLID_REVOLUTION_VERSION>) {
  const capture = useCallback((initial: SolidRevolutionInitial | null) => onChange(initial ? {
    toolId: "solid-revolution", contentVersion: SOLID_REVOLUTION_VERSION, payload: { title, initial },
  } : null), [title, onChange]);
  return <ToolPreparationStage version={SOLID_REVOLUTION_VERSION} fullHeight={fullHeight}><Workspace initial={existing?.payload.initial} onSnapshot={capture} /></ToolPreparationStage>;
}
export const solidRevolutionSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: SOLID_REVOLUTION_VERSION, Preparation,
  Presentation: ({ scene, classroom }) => <Workspace initial={scene.payload.initial} readOnly={!!(classroom && !classroom.onChange)} classroom={toolSceneRuntime<typeof SOLID_REVOLUTION_VERSION>(scene, classroom)} />,
});
