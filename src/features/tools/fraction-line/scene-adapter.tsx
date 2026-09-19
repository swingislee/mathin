"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { FRACTION_COURSEWARE_VERSION, type FractionScene } from "../scenes/numeric-teaching-content";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";

const Fraction = dynamic(() => import("./FractionLine").then((m) => m.FractionLine), { ssr: false, loading: () => <Skeleton className="size-full" /> });
const FractionCourseware = dynamic(() => import("../courseware/NumericTeachingCourseware").then((m) => m.FractionSceneCourseware));

function Preparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof FRACTION_COURSEWARE_VERSION>) {
  const capture = useCallback((initial: FractionScene | null) => onChange(initial ? {
    toolId: "fraction-line", contentVersion: FRACTION_COURSEWARE_VERSION, payload: { title, initial },
  } : null), [onChange, title]);
  return <ToolPreparationStage version={FRACTION_COURSEWARE_VERSION} fullHeight={fullHeight}>
    <Fraction embedded initial={existing?.payload.initial} onSnapshot={capture} />
  </ToolPreparationStage>;
}

export const fractionSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: FRACTION_COURSEWARE_VERSION, Preparation,
  Presentation: ({ scene, classroom }) => <FractionCourseware tool={scene} classroom={classroom} />,
});
