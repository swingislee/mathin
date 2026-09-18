"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FractionLine } from "../fraction-line/FractionLine";
import { MotionLab } from "../motion-lab/MotionLab";
import { FRACTION_COURSEWARE_VERSION, MOTION_COURSEWARE_VERSION, type NumericTeachingTool } from "./numeric-teaching-content";
import type { CoursewareToolRuntime } from "./tool-classroom";
import { useTeachingWorkbench } from "./useTeachingWorkbench";

function FractionScene({ tool, classroom }: { tool: Extract<NumericTeachingTool, { toolId: "fraction-line" }>; classroom?: CoursewareToolRuntime }) {
  const t = useTranslations("teacherMicrocourses");
  const host = useTeachingWorkbench<typeof tool.payload.initial, never>(tool.payload.initial, {
    state: classroom?.state?.contentVersion === FRACTION_COURSEWARE_VERSION ? classroom.state.state : undefined,
    onChange: classroom?.onChange ? (state) => classroom.onChange!({ toolId: "fraction-line", contentVersion: FRACTION_COURSEWARE_VERSION, state }) : undefined,
  });
  return <><SceneControls writable={!!classroom?.onChange} pending={host.port.pending} failed={host.failed} reset={host.port.reset} label={t("cubeToolbarReset")} error={t("cubeClassroomSyncError")} />
    <FractionLine key={host.key} embedded initial={host.initial} onSnapshot={host.port.capture} readOnly={!classroom?.onChange || host.port.pending} /></>;
}
function MotionScene({ tool, classroom }: { tool: Extract<NumericTeachingTool, { toolId: "motion-lab" }>; classroom?: CoursewareToolRuntime }) {
  const t = useTranslations("teacherMicrocourses");
  const host = useTeachingWorkbench<typeof tool.payload.initial, never>(tool.payload.initial, {
    state: classroom?.state?.contentVersion === MOTION_COURSEWARE_VERSION ? classroom.state.state : undefined,
    onChange: classroom?.onChange ? (state) => classroom.onChange!({ toolId: "motion-lab", contentVersion: MOTION_COURSEWARE_VERSION, state }) : undefined,
  });
  return <><SceneControls writable={!!classroom?.onChange} pending={host.port.pending} failed={host.failed} reset={host.port.reset} label={t("cubeToolbarReset")} error={t("cubeClassroomSyncError")} />
    <MotionLab key={host.key} embedded initial={host.initial} onSnapshot={host.port.capture} readOnly={!classroom?.onChange || host.port.pending} /></>;
}
function SceneControls({ writable, pending, failed, reset, label, error }: { writable: boolean; pending: boolean; failed: boolean; reset: () => void; label: string; error: string }) {
  return <>{failed && <p role="alert" className="px-3 text-sm text-rose">{error}</p>}{writable && <div className="flex justify-end px-2 py-1"><Button variant="ghost" size="sm" disabled={pending} onClick={reset}>{label}</Button></div>}</>;
}
export function NumericTeachingCourseware({ tool, classroom }: { tool: NumericTeachingTool; classroom?: CoursewareToolRuntime }) {
  return <section className="flex size-full min-h-0 flex-col bg-paper" aria-label={tool.payload.title}>
    {tool.toolId === "fraction-line" ? <FractionScene key={JSON.stringify(tool.payload)} tool={tool} classroom={classroom} /> : <MotionScene key={JSON.stringify(tool.payload)} tool={tool} classroom={classroom} />}
  </section>;
}
