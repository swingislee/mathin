"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";
import { toolSceneRuntime } from "../scenes/runtime";
import { SOLID_GEOMETRY_EXPLORATION_VERSION, upgradeSolidGeometryInitial, type SolidGeometryExplorationInitial } from "./exploration-contract";

const Workspace = dynamic(() => import("./SolidGeometryExplorationWorkspace").then((m) => m.SolidGeometryExplorationWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });
function Preparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof SOLID_GEOMETRY_EXPLORATION_VERSION>) {
  const capture = useCallback((initial: SolidGeometryExplorationInitial | null) => onChange(initial ? { toolId: "solid-geometry", contentVersion: SOLID_GEOMETRY_EXPLORATION_VERSION, payload: { title, initial } } : null), [title, onChange]);
  return <ToolPreparationStage version={SOLID_GEOMETRY_EXPLORATION_VERSION} fullHeight={fullHeight}><Workspace initial={existing?.payload.initial} onSnapshot={capture} /></ToolPreparationStage>;
}
export const solidGeometryExplorationSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: SOLID_GEOMETRY_EXPLORATION_VERSION, Preparation,
  Presentation: ({ scene, classroom }) => <Workspace initial={scene.payload.initial} readOnly={Boolean(classroom && !classroom.onChange)} classroom={toolSceneRuntime<typeof SOLID_GEOMETRY_EXPLORATION_VERSION>(scene, classroom)} />,
  upgrade: (scene) => scene.contentVersion === "solid-geometry-lesson-v1" ? { toolId: "solid-geometry", contentVersion: SOLID_GEOMETRY_EXPLORATION_VERSION, payload: { title: scene.payload.title, initial: upgradeSolidGeometryInitial(scene.payload.initial) } } : null,
});
