"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { useLocale } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { DICE_COURSEWARE_VERSION } from "../scenes/registry";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";
import type { DiceTeachingSnapshot } from "../courseware/spatial-teaching-content";

const Dice = dynamic(() => import("./DiceTeachingWorkspace"), { ssr: false, loading: () => <Skeleton className="size-full" /> });
const DiceCourseware = dynamic(() => import("../courseware/SpatialTeachingCourseware").then((m) => m.DiceSceneCourseware));

function Preparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof DICE_COURSEWARE_VERSION>) {
  const locale = useLocale() === "en" ? "en" : "zh";
  const capture = useCallback((initial: DiceTeachingSnapshot | null) => onChange(initial ? {
    toolId: "spatial-lab", contentVersion: DICE_COURSEWARE_VERSION, payload: { title, initial },
  } : null), [onChange, title]);
  return <ToolPreparationStage version={DICE_COURSEWARE_VERSION} fullHeight={fullHeight}>
    <Dice locale={locale} initial={existing?.payload.initial} onSnapshot={capture} courseware />
  </ToolPreparationStage>;
}

export const diceSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: DICE_COURSEWARE_VERSION, Preparation,
  Presentation: ({ scene, classroom }) => <DiceCourseware tool={scene} classroom={classroom} />,
});
