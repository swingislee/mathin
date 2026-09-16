"use client";

import dynamic from "next/dynamic";
import { useLocale } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { DICE_COURSEWARE_VERSION } from "./registry";
import type { SpatialTeachingTool } from "./spatial-teaching-content";

const DiceWorkspace = dynamic(() => import("../spatial-lab/DiceTeachingWorkspace"), { ssr: false, loading: () => <Skeleton className="size-full" /> });
const NetWorkspace = dynamic(() => import("../spatial-lab/CubeNetFoldWorkspace").then((module) => module.CubeNetFoldWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });

/** 备课和课堂读取相同固定副本，不访问个人草稿，也不切回独立工具页的默认场景。 */
export function SpatialTeachingCourseware({ tool }: { tool: SpatialTeachingTool }) {
  const locale = useLocale() === "en" ? "en" : "zh";
  return <section className="flex size-full min-h-0 flex-col" aria-label={tool.payload.title} data-spatial-courseware={tool.contentVersion}>
    {tool.contentVersion === DICE_COURSEWARE_VERSION
      ? <DiceWorkspace key={JSON.stringify(tool.payload)} locale={locale} initial={tool.payload.initial} courseware readOnly />
      : <NetWorkspace key={JSON.stringify(tool.payload)} locale={locale} initial={tool.payload.initial} courseware readOnly />}
  </section>;
}
