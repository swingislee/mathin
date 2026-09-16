"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { CUBE_NET_COURSEWARE_VERSION, DICE_COURSEWARE_VERSION } from "./registry";
import type { SpatialTeachingTool } from "./spatial-teaching-content";
import type { CoursewareToolRuntime } from "./tool-classroom";
import { useTeachingWorkbench } from "./useTeachingWorkbench";
import type { DiceLiveSnapshot, DiceTeachingCommand, NetLiveSnapshot, NetTeachingCommand } from "./workbench-classroom-contract";

const DiceWorkspace = dynamic(() => import("../spatial-lab/DiceTeachingWorkspace"), { ssr: false, loading: () => <Skeleton className="size-full" /> });
const NetWorkspace = dynamic(() => import("../spatial-lab/CubeNetFoldWorkspace").then((module) => module.CubeNetFoldWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });

/** 备课和课堂读取相同固定副本，不访问个人草稿，也不切回独立工具页的默认场景。 */
function DiceCourseware({ tool, classroom }: { tool: Extract<SpatialTeachingTool, { contentVersion: "dice-lesson-v1" }>; classroom?: CoursewareToolRuntime }) {
  const locale = useLocale() === "en" ? "en" : "zh";
  const labels = useTranslations("teacherMicrocourses");
  const initial = useMemo<DiceLiveSnapshot>(() => ({ ...tool.payload.initial, xrayTarget: null, observation: { panel: null, face: "y+", pair: "y+" } }), [tool.payload]);
  const host = useTeachingWorkbench<DiceLiveSnapshot, DiceTeachingCommand>(initial, {
    state: classroom?.state?.contentVersion === DICE_COURSEWARE_VERSION ? classroom.state.state : undefined,
    onChange: classroom?.onChange ? (state) => classroom.onChange!({ toolId: "spatial-lab", contentVersion: DICE_COURSEWARE_VERSION, state }) : undefined,
  });
  return <>{host.failed && <p role="alert" className="absolute inset-x-2 top-12 z-50 bg-paper p-2 text-xs text-rose">{labels("spatialClassroomSyncError")}</p>}
    <DiceWorkspace key={host.key} locale={locale} initial={host.initial} courseware readOnly={!classroom?.onChange}
      classroom={classroom ? { ...host.port, resetLabel: labels("cubeToolbarReset") } : undefined} /></>;
}
function NetCourseware({ tool, classroom }: { tool: Extract<SpatialTeachingTool, { contentVersion: "cube-net-lesson-v1" }>; classroom?: CoursewareToolRuntime }) {
  const locale = useLocale() === "en" ? "en" : "zh";
  const labels = useTranslations("teacherMicrocourses");
  const initial = useMemo<NetLiveSnapshot>(() => ({ ...tool.payload.initial, judgment: null, galleryOpen: false }), [tool.payload]);
  const host = useTeachingWorkbench<NetLiveSnapshot, NetTeachingCommand>(initial, {
    state: classroom?.state?.contentVersion === CUBE_NET_COURSEWARE_VERSION ? classroom.state.state : undefined,
    onChange: classroom?.onChange ? (state) => classroom.onChange!({ toolId: "spatial-lab", contentVersion: CUBE_NET_COURSEWARE_VERSION, state }) : undefined,
  });
  return <>{host.failed && <p role="alert" className="absolute inset-x-2 top-12 z-50 bg-paper p-2 text-xs text-rose">{labels("spatialClassroomSyncError")}</p>}
    <NetWorkspace key={host.key} locale={locale} initial={host.initial} courseware readOnly={!classroom?.onChange}
      classroom={classroom ? { ...host.port, resetLabel: labels("cubeToolbarReset") } : undefined} /></>;
}
export function SpatialTeachingCourseware({ tool, classroom }: { tool: SpatialTeachingTool; classroom?: CoursewareToolRuntime }) {
  return <section className="relative flex size-full min-h-0 flex-col" aria-label={tool.payload.title} data-spatial-courseware={tool.contentVersion}>
    {tool.contentVersion === DICE_COURSEWARE_VERSION
      ? <DiceCourseware key={JSON.stringify(tool.payload)} tool={tool} classroom={classroom} />
      : <NetCourseware key={JSON.stringify(tool.payload)} tool={tool} classroom={classroom} />}
  </section>;
}
