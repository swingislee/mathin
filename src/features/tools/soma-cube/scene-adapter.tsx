"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { defineToolWorkbenchAdapter, ToolPreparationStage, type ToolPreparationProps } from "../scenes/workbench-adapter";
import { toolSceneRuntime } from "../scenes/runtime";
import { SOMA_VERSION, SOMA_LEGACY_VERSION, somaLegacySnapshotSchema, somaToolSchema, type SomaSnapshot } from "./contract";

const Workspace = dynamic(() => import("./SomaWorkspace").then((module) => module.SomaWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });
function Preparation({ existing, title, fullHeight, onChange, version }: ToolPreparationProps<typeof SOMA_VERSION | typeof SOMA_LEGACY_VERSION> & { version: typeof SOMA_VERSION | typeof SOMA_LEGACY_VERSION }) {
  const capture = useCallback((initial: SomaSnapshot | null) => onChange(initial ? {
    toolId: "soma-cube", contentVersion: version, payload: { title, initial },
  } : null), [title, onChange, version]);
  return <ToolPreparationStage version={version} fullHeight={fullHeight}><Workspace initial={existing?.payload.initial} onSnapshot={capture} freeRotation={version === SOMA_VERSION} /></ToolPreparationStage>;
}
export const somaSceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: SOMA_VERSION, Preparation: (props) => <Preparation {...props} version={SOMA_VERSION} />,
  Presentation: ({ scene, classroom }) => <Workspace initial={scene.payload.initial} readOnly={Boolean(classroom && !classroom.onChange)}
    classroom={toolSceneRuntime<typeof SOMA_VERSION>(scene, classroom)} />,
  upgrade: (scene) => scene.contentVersion === SOMA_LEGACY_VERSION ? somaToolSchema.parse({ ...structuredClone(scene), contentVersion: SOMA_VERSION }) : null,
});
export const somaLegacySceneAdapter = defineToolWorkbenchAdapter({
  contentVersion: SOMA_LEGACY_VERSION, Preparation: (props) => <Preparation {...props} version={SOMA_LEGACY_VERSION} />,
  Presentation: ({ scene, classroom }) => {
    const runtime = toolSceneRuntime<typeof SOMA_LEGACY_VERSION>(scene, classroom);
    return <Workspace initial={scene.payload.initial} freeRotation={false} readOnly={Boolean(classroom && !classroom.onChange)} classroom={runtime ? {
      state: runtime.state, onChange: runtime.onChange ? (next) => runtime.onChange!(somaLegacySnapshotSchema.parse(next)) : undefined,
    } : undefined} />;
  },
});
