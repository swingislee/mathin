"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";
import { toolSceneRuntime } from "../scenes/runtime";
import { NET_TEACHING_VERSION, netTeachingToolSchema, type NetTeachingInitial } from "./contract";

const Workspace = dynamic(() => import("./NetTeachingWorkspace").then((m) => m.NetTeachingWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });
function Preparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof NET_TEACHING_VERSION>) {
  const capture = useCallback((initial: NetTeachingInitial | null) => onChange(initial ? {
    toolId: "spatial-lab", contentVersion: NET_TEACHING_VERSION, payload: { title, initial },
  } : null), [title, onChange]);
  return <ToolPreparationStage version={NET_TEACHING_VERSION} fullHeight={fullHeight}>
    <Workspace initial={existing?.payload.initial} onSnapshot={capture} />
  </ToolPreparationStage>;
}
export const netTeachingSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: NET_TEACHING_VERSION, Preparation,
  Presentation: ({ scene, classroom }) => <Workspace initial={scene.payload.initial} readOnly={Boolean(classroom && !classroom.onChange)}
    runtime={toolSceneRuntime<typeof NET_TEACHING_VERSION>(scene, classroom)} />,
  upgrade: (scene) => scene.contentVersion === "cube-net-lesson-v1" ? netTeachingToolSchema.parse({
    ...scene, contentVersion: NET_TEACHING_VERSION, payload: { ...scene.payload, initial: { mode: "standard", data: scene.payload.initial } },
  }) : null,
});
