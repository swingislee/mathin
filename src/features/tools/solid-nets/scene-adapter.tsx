"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";
import { toolSceneRuntime } from "../scenes/runtime";
import { SOLID_NETS_LESSON_VERSION, SOLID_NETS_POLYHEDRA_LESSON_VERSION, SOLID_NETS_SNAPSHOT_VERSION, SOLID_NETS_POLYHEDRA_VERSION,
  solidNetsTeachingSnapshotSchema, solidNetsPolyhedraSnapshotSchema, solidNetsPolyhedraToolSchema, type PreparedSolidNetsSnapshot } from "./contract";

const Workspace = dynamic(() => import("./SolidNetsTool").then((m) => m.SolidNetsTool), { ssr: false, loading: () => <Skeleton className="size-full" /> });
type LessonVersion = typeof SOLID_NETS_LESSON_VERSION | typeof SOLID_NETS_POLYHEDRA_LESSON_VERSION;
function Preparation({ existing, title, fullHeight, onChange, version }: ToolPreparationProps<LessonVersion> & { version: LessonVersion }) {
  const capture = useCallback((initial: PreparedSolidNetsSnapshot | null) => onChange(initial ? {
    toolId: "solid-nets", contentVersion: version, payload: { title, initial },
  } : null), [title, onChange, version]);
  return <ToolPreparationStage version={version} fullHeight={fullHeight}>
    <Workspace initial={existing?.payload.initial} version={version === SOLID_NETS_LESSON_VERSION ? SOLID_NETS_SNAPSHOT_VERSION : SOLID_NETS_POLYHEDRA_VERSION} onSnapshot={capture} />
  </ToolPreparationStage>;
}
export const solidNetsSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: SOLID_NETS_LESSON_VERSION, Preparation: (props) => <Preparation {...props} version={SOLID_NETS_LESSON_VERSION} />,
  Presentation: ({ scene, classroom }) => {
    const runtime = toolSceneRuntime<typeof SOLID_NETS_LESSON_VERSION>(scene, classroom);
    return <Workspace initial={scene.payload.initial} readOnly={Boolean(classroom && !classroom.onChange)} runtime={runtime ? {
      state: runtime.state, onChange: runtime.onChange ? (next) => runtime.onChange!(solidNetsTeachingSnapshotSchema.parse(next)) : undefined,
    } : undefined} />;
  },
});
export const solidNetsPolyhedraSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: SOLID_NETS_POLYHEDRA_LESSON_VERSION, Preparation: (props) => <Preparation {...props} version={SOLID_NETS_POLYHEDRA_LESSON_VERSION} />,
  Presentation: ({ scene, classroom }) => {
    const runtime = toolSceneRuntime<typeof SOLID_NETS_POLYHEDRA_LESSON_VERSION>(scene, classroom);
    return <Workspace initial={scene.payload.initial} readOnly={Boolean(classroom && !classroom.onChange)} runtime={runtime ? {
      state: runtime.state, onChange: runtime.onChange ? (next) => runtime.onChange!(solidNetsPolyhedraSnapshotSchema.parse(next)) : undefined,
    } : undefined} />;
  },
  upgrade: (scene) => scene.contentVersion === SOLID_NETS_LESSON_VERSION ? solidNetsPolyhedraToolSchema.parse({
    ...structuredClone(scene), contentVersion: SOLID_NETS_POLYHEDRA_LESSON_VERSION,
    payload: { ...structuredClone(scene.payload), initial: { ...structuredClone(scene.payload.initial), version: SOLID_NETS_POLYHEDRA_VERSION } },
  }) : null,
});
