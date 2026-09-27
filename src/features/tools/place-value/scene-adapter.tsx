"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";
import { toolSceneRuntime } from "../scenes/runtime";
import { PLACE_VALUE_VERSION, type PlaceValueInitial } from "./radix-contract";
import { PLACE_VALUE_VERSION as LEGACY_VERSION, type PlaceValueInitial as LegacyInitial, type PlaceValueSnapshot as LegacySnapshot } from "./contract";
import { downgradePlaceValueInitial, downgradePlaceValueSnapshot, upgradePlaceValueInitial, upgradePlaceValueSnapshot } from "./legacy-adapter";
import type { PlaceValueWorkspaceProps } from "./PlaceValueWorkspace";

const Workspace = dynamic(() => import("./PlaceValueWorkspace").then((module) => module.PlaceValueWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });
function Preparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof PLACE_VALUE_VERSION>) {
  const capture = useCallback((initial: PlaceValueInitial | null) => onChange(initial ? {
    toolId: "place-value", contentVersion: PLACE_VALUE_VERSION, payload: { title, initial },
  } : null), [title, onChange]);
  return <ToolPreparationStage version={PLACE_VALUE_VERSION} fullHeight={fullHeight}><Workspace initial={existing?.payload.initial} onSnapshot={capture} /></ToolPreparationStage>;
}
export const placeValueSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: PLACE_VALUE_VERSION, Preparation,
  Presentation: ({ scene, classroom }) => <Workspace initial={scene.payload.initial} readOnly={!!(classroom && !classroom.onChange)} classroom={toolSceneRuntime<typeof PLACE_VALUE_VERSION>(scene, classroom)} />,
});
function LegacyWorkspace({ initial, onSnapshot, classroom, readOnly }: { initial: LegacyInitial; onSnapshot?: (initial: LegacyInitial | null) => void;
  classroom?: { state?: LegacySnapshot; onChange?: (state: LegacySnapshot) => Promise<void> }; readOnly?: boolean }) {
  const origin = useMemo(() => upgradePlaceValueInitial(initial), [initial]);
  const runtime = useMemo<PlaceValueWorkspaceProps["classroom"]>(() => classroom ? {
    state: classroom.state ? upgradePlaceValueSnapshot(classroom.state) : undefined,
    onChange: classroom.onChange ? (state) => classroom.onChange!(downgradePlaceValueSnapshot(state)) : undefined,
  } : undefined, [classroom]);
  const capture = useCallback((value: PlaceValueInitial | null) => onSnapshot?.(value ? downgradePlaceValueInitial(value) : null), [onSnapshot]);
  return <Workspace initial={origin} onSnapshot={capture} classroom={runtime} readOnly={readOnly} legacy />;
}
function LegacyPreparation({ existing, title, fullHeight, onChange }: ToolPreparationProps<typeof LEGACY_VERSION>) {
  const capture = useCallback((initial: LegacyInitial | null) => onChange(initial ? { toolId: "place-value", contentVersion: LEGACY_VERSION, payload: { title, initial } } : null), [title, onChange]);
  return existing ? <ToolPreparationStage version={LEGACY_VERSION} fullHeight={fullHeight}><LegacyWorkspace initial={existing.payload.initial} onSnapshot={capture} /></ToolPreparationStage> : null;
}
export const placeValueLegacySceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: LEGACY_VERSION, Preparation: LegacyPreparation,
  Presentation: ({ scene, classroom }) => <LegacyWorkspace initial={scene.payload.initial} readOnly={!!(classroom && !classroom.onChange)} classroom={toolSceneRuntime<typeof LEGACY_VERSION>(scene, classroom)} />,
});
