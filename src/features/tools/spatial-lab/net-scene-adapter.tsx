"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { useLocale } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { CUBE_NET_COURSEWARE_VERSION } from "../scenes/registry";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";
import type { CubeNetTeachingSnapshot } from "../courseware/spatial-teaching-content";

const Net = dynamic(() => import("./CubeNetFoldWorkspace").then((m) => m.CubeNetFoldWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });
const NetCourseware = dynamic(() => import("../courseware/SpatialTeachingCourseware").then((m) => m.NetSceneCourseware));

function Preparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof CUBE_NET_COURSEWARE_VERSION>) {
  const locale = useLocale() === "en" ? "en" : "zh";
  const capture = useCallback((initial: CubeNetTeachingSnapshot | null) => onChange(initial ? {
    toolId: "spatial-lab", contentVersion: CUBE_NET_COURSEWARE_VERSION, payload: { title, initial },
  } : null), [onChange, title]);
  return <ToolPreparationStage version={CUBE_NET_COURSEWARE_VERSION} fullHeight={fullHeight}>
    <Net locale={locale} initial={existing?.payload.initial} onSnapshot={capture} courseware />
  </ToolPreparationStage>;
}

export const netSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: CUBE_NET_COURSEWARE_VERSION, Preparation,
  Presentation: ({ scene, classroom }) => <NetCourseware tool={scene} classroom={classroom} />,
});
