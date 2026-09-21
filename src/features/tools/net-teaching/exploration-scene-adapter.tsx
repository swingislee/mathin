"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";
import { toolSceneRuntime } from "../scenes/runtime";
import { CUBE_NET_EXPLORATION_VERSION, cubeNetExplorationToolSchema, type CubeNetExplorationInitial } from "./contract";

const Workspace = dynamic(() => import("./CubeNetExplorationWorkspace").then((m) => m.CubeNetExplorationWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });
function Preparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof CUBE_NET_EXPLORATION_VERSION>) {
  const capture = useCallback((initial: CubeNetExplorationInitial | null) => onChange(initial ? {
    toolId: "spatial-lab", contentVersion: CUBE_NET_EXPLORATION_VERSION, payload: { title, initial },
  } : null), [title, onChange]);
  return <ToolPreparationStage version={CUBE_NET_EXPLORATION_VERSION} fullHeight={fullHeight}>
    <Workspace initial={existing?.payload.initial} onSnapshot={capture} />
  </ToolPreparationStage>;
}
export const cubeNetExplorationSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: CUBE_NET_EXPLORATION_VERSION, Preparation,
  Presentation: ({ scene, classroom }) => <Workspace initial={scene.payload.initial} readOnly={Boolean(classroom && !classroom.onChange)}
    runtime={toolSceneRuntime<typeof CUBE_NET_EXPLORATION_VERSION>(scene, classroom)} />,
  upgrade: (scene) => {
    if (scene.contentVersion === "cube-net-lesson-v1") return cubeNetExplorationToolSchema.parse({
      ...scene, contentVersion: CUBE_NET_EXPLORATION_VERSION, payload: { ...scene.payload, initial: { mode: "standard", data: scene.payload.initial } },
    });
    if (scene.contentVersion === "cube-net-lesson-v2" && scene.payload.initial.mode !== "solid-net") return cubeNetExplorationToolSchema.parse({ ...scene, contentVersion: CUBE_NET_EXPLORATION_VERSION });
    return null;
  },
});
