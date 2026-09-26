"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps, type ToolWorkbenchAdapter } from "../scenes/workbench-adapter";
import { toolSceneRuntime } from "../scenes/runtime";
import { PLANAR_TOOLS, type PlanarState, type PlanarVersion } from "./contract";

const Workspace = dynamic(() => import("./PlanarWorkbench").then((module) => module.PlanarWorkbench), { ssr: false, loading: () => <Skeleton className="size-full" /> });
function makeAdapter(tool: (typeof PLANAR_TOOLS)[number]) {
  function Preparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<PlanarVersion>) {
    const capture = useCallback((initial: PlanarState | null) => onChange(initial ? {
      toolId: tool.id, contentVersion: tool.version, payload: { title, initial },
    } : null), [title, onChange]);
    return <ToolPreparationStage version={tool.version} fullHeight={fullHeight}><Workspace toolId={tool.id} initial={existing?.payload.initial} onSnapshot={capture} /></ToolPreparationStage>;
  }
  return defineToolWorkbenchAdapter({
    contentVersion: tool.version, Preparation,
    Presentation: ({ scene, classroom }) => <Workspace toolId={tool.id} initial={scene.payload.initial} readOnly={!!(classroom && !classroom.onChange)} classroom={toolSceneRuntime<PlanarVersion>(scene, classroom)} />,
  });
}
/** 新的平面教具只登记一次目录；备课、课件编辑、课堂与独立工具页复用同一组件。 */
export const planarSceneAdapters = Object.fromEntries(PLANAR_TOOLS.map((tool) => [tool.version, makeAdapter(tool)])) as Record<PlanarVersion, ToolWorkbenchAdapter>;
