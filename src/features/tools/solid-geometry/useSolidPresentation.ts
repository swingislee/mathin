"use client";

import type { SolidEntity } from "./solid-geometry-contract";
import { interpolateSolidEntities, SOLID_TRANSITION_MS } from "./solid-geometry-motion";
import { useSpatialPresentation } from "../spatial-interaction/useSpatialPresentation";

export function solidEntitiesKey(entities: readonly SolidEntity[]) { return JSON.stringify(entities); }
/** 仅表现帧使用 rAF；共用课堂接口只接收离散终点。手动拖动终点无需重播。 */
export function useSolidPresentation(target: readonly SolidEntity[], instantKey: string | null) {
  const presentation = useSpatialPresentation({ target, key: solidEntitiesKey(target), interpolate: interpolateSolidEntities, instantKey, durationMs: SOLID_TRANSITION_MS });
  return { entities: presentation.value, animating: presentation.animating };
}
