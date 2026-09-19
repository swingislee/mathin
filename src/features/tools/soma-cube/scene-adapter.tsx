"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";
import { toolSceneRuntime } from "../scenes/runtime";
import { SOMA_VERSION, type SomaSnapshot } from "./contract";

const Workspace = dynamic(() => import("./SomaWorkspace").then((module) => module.SomaWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });
function Preparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof SOMA_VERSION>) {
  const capture = useCallback((initial: SomaSnapshot | null) => onChange(initial ? {
    toolId: "soma-cube", contentVersion: SOMA_VERSION, payload: { title, initial },
  } : null), [title, onChange]);
  return <ToolPreparationStage version={SOMA_VERSION} fullHeight={fullHeight}><Workspace initial={existing?.payload.initial} onSnapshot={capture} /></ToolPreparationStage>;
}
export const somaSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: SOMA_VERSION, Preparation,
  Presentation: ({ scene, classroom }) => <Workspace initial={scene.payload.initial} readOnly={Boolean(classroom && !classroom.onChange)}
    classroom={toolSceneRuntime<typeof SOMA_VERSION>(scene, classroom)} />,
});
