"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MOTION_COURSEWARE_VERSION, type MotionScene } from "../scenes/numeric-teaching-content";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";

const Motion = dynamic(() => import("./MotionLab").then((m) => m.MotionLab), { ssr: false, loading: () => <Skeleton className="size-full" /> });
const MotionCourseware = dynamic(() => import("../courseware/NumericTeachingCourseware").then((m) => m.MotionSceneCourseware));

function Preparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof MOTION_COURSEWARE_VERSION>) {
  const capture = useCallback((initial: MotionScene | null) => onChange(initial ? {
    toolId: "motion-lab", contentVersion: MOTION_COURSEWARE_VERSION, payload: { title, initial },
  } : null), [onChange, title]);
  return <ToolPreparationStage version={MOTION_COURSEWARE_VERSION} fullHeight={fullHeight}>
    <Motion embedded initial={existing?.payload.initial} onSnapshot={capture} preparation />
  </ToolPreparationStage>;
}

export const motionSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: MOTION_COURSEWARE_VERSION, Preparation,
  Presentation: ({ scene, classroom }) => <MotionCourseware tool={scene} classroom={classroom} />,
});
