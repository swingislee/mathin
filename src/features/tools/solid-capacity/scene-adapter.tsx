"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";
import { toolSceneRuntime } from "../scenes/runtime";
import { SOLID_CAPACITY_VERSION, type SolidCapacityInitial } from "./solid-capacity-contract";
import { SOLID_CAPACITY_TEACHING_VERSION, createDefaultSolidCapacityTeachingInitial, solidCapacityTeachingToolSchema, type SolidCapacityTeachingInitial } from "./solid-capacity-teaching-contract";

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

const TeachingWorkspace = dynamic(() => import("./SolidCapacityTeachingWorkspace").then((m) => m.SolidCapacityTeachingWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });
function TeachingPreparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof SOLID_CAPACITY_TEACHING_VERSION>) {
  const capture = useCallback((initial: SolidCapacityTeachingInitial | null) => onChange(initial ? {
    toolId: "solid-capacity", contentVersion: SOLID_CAPACITY_TEACHING_VERSION, payload: { title, initial },
  } : null), [title, onChange]);
  return <ToolPreparationStage version={SOLID_CAPACITY_TEACHING_VERSION} fullHeight={fullHeight}><TeachingWorkspace initial={existing?.payload.initial} onSnapshot={capture} /></ToolPreparationStage>;
}
export const solidCapacityTeachingSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: SOLID_CAPACITY_TEACHING_VERSION, Preparation: TeachingPreparation,
  Presentation: ({ scene, classroom }) => <TeachingWorkspace initial={scene.payload.initial} readOnly={Boolean(classroom && !classroom.onChange)}
    classroom={toolSceneRuntime<typeof SOLID_CAPACITY_TEACHING_VERSION>(scene, classroom)} />,
  upgrade: (scene) => scene.contentVersion === SOLID_CAPACITY_VERSION ? solidCapacityTeachingToolSchema.parse({
    toolId: "solid-capacity", contentVersion: SOLID_CAPACITY_TEACHING_VERSION, payload: { title: scene.payload.title,
      initial: { ...createDefaultSolidCapacityTeachingInitial(), pour: structuredClone(scene.payload.initial) } },
  }) : null,
});
