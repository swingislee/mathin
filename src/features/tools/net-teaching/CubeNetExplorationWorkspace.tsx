"use client";

import { useCallback, useMemo } from "react";
import { NetTeachingWorkspace } from "./NetTeachingWorkspace";
import { cubeNetExplorationInitialSchema, cubeNetExplorationStateSchema, type CubeNetExplorationInitial, type CubeNetExplorationState, type NetTeachingInitial, type NetTeachingState } from "./contract";

/** 正方体专用入口只限定教学范围，实际折纸仍复用同一工作台。 */
export function CubeNetExplorationWorkspace({ initial, runtime, onSnapshot, readOnly }: {
  initial?: CubeNetExplorationInitial;
  runtime?: { state?: CubeNetExplorationState; onChange?: (next: CubeNetExplorationState) => Promise<void> };
  onSnapshot?: (next: CubeNetExplorationInitial | null) => void;
  readOnly?: boolean;
}) {
  const capture = useCallback((next: NetTeachingInitial | null) => onSnapshot?.(next ? cubeNetExplorationInitialSchema.parse(next) : null), [onSnapshot]);
  const port = useMemo(() => runtime && ({ state: runtime.state,
    onChange: runtime.onChange ? (next: NetTeachingState) => runtime.onChange!(cubeNetExplorationStateSchema.parse(next)) : undefined,
  }), [runtime]);
  return <NetTeachingWorkspace scope="cube" initial={initial} runtime={port} onSnapshot={capture} readOnly={readOnly} />;
}
