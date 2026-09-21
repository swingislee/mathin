"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";
import { toolSceneRuntime } from "../scenes/runtime";
import { SOLID_NETS_COMPLETE_VERSION, solidNetsCompleteToolSchema, type SolidNetsCompleteSnapshot } from "./curved-contract";
import { SOLID_NETS_LESSON_VERSION, SOLID_NETS_POLYHEDRA_LESSON_VERSION, SOLID_NETS_POLYHEDRA_VERSION } from "./contract";

const Workspace = dynamic(() => import("./SolidNetsCompleteWorkspace").then((m) => m.SolidNetsCompleteWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });
function Preparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof SOLID_NETS_COMPLETE_VERSION>) {
  const capture = useCallback((initial: SolidNetsCompleteSnapshot | null) => onChange(initial ? { toolId: "solid-nets", contentVersion: SOLID_NETS_COMPLETE_VERSION, payload: { title, initial } } : null), [title, onChange]);
  return <ToolPreparationStage version={SOLID_NETS_COMPLETE_VERSION} fullHeight={fullHeight}><Workspace initial={existing?.payload.initial} onSnapshot={capture} /></ToolPreparationStage>;
}
export const solidNetsCompleteSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: SOLID_NETS_COMPLETE_VERSION, Preparation,
  Presentation: ({ scene, classroom }) => <Workspace initial={scene.payload.initial} readOnly={Boolean(classroom && !classroom.onChange)} runtime={toolSceneRuntime<typeof SOLID_NETS_COMPLETE_VERSION>(scene, classroom)} />,
  upgrade: (scene) => scene.contentVersion === SOLID_NETS_LESSON_VERSION || scene.contentVersion === SOLID_NETS_POLYHEDRA_LESSON_VERSION ? solidNetsCompleteToolSchema.parse({
    toolId: "solid-nets", contentVersion: SOLID_NETS_COMPLETE_VERSION, payload: { title: scene.payload.title, initial: { mode: "polyhedron", data: { ...structuredClone(scene.payload.initial), version: SOLID_NETS_POLYHEDRA_VERSION } } },
  }) : null,
});
