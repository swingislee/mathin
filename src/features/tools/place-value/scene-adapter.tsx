"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";
import { toolSceneRuntime } from "../scenes/runtime";
import { PLACE_VALUE_VERSION, type PlaceValueInitial } from "./contract";

const Workspace = dynamic(() => import("./PlaceValueWorkspace").then((module) => module.PlaceValueWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });
function Preparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof PLACE_VALUE_VERSION>) {
  const capture = useCallback((initial: PlaceValueInitial | null) => onChange(initial ? {
    toolId: "place-value", contentVersion: PLACE_VALUE_VERSION, payload: { title, initial },
  } : null), [title, onChange]);
  return <ToolPreparationStage version={PLACE_VALUE_VERSION} fullHeight={fullHeight}><Workspace initial={existing?.payload.initial} onSnapshot={capture} /></ToolPreparationStage>;
}
export const placeValueSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: PLACE_VALUE_VERSION, Preparation,
  Presentation: ({ scene, classroom }) => <Workspace initial={scene.payload.initial} readOnly={!!(classroom && !classroom.onChange)} classroom={toolSceneRuntime<typeof PLACE_VALUE_VERSION>(scene, classroom)} />,
});
