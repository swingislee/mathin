"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { VoxelRendererMessages } from "@/features/spatial-math/renderer-r3f/VoxelFallback";
import { CubeStructuresViewport } from "../spatial-lab/CubeStructuresViewport";
import { buildCubeStructureRenderModel, CUBE_COLORS, replayCubeHistory } from "../spatial-lab/cube-structures-contract";
import type { CubeCoursewarePayload } from "./cube-structures-content";

const colors = Object.fromEntries(CUBE_COLORS.map((color) => [color, color]));
const noop = () => {};

/** 组合页只展示冻结起点；插入弹窗的本地预览明确与课堂同步状态分离。 */
export function CubeStructuresCourseware({ payload, preview = false }: {
  payload: CubeCoursewarePayload; preview?: boolean;
}) {
  const t = useTranslations("tools.spatialLab");
  const labels = useTranslations("teacherMicrocourses");
  const [cursor, setCursor] = useState(0);
  const [moving, setMoving] = useState(false);
  const step = preview ? Math.min(cursor, payload.history.operations.length) : 0;
  const state = useMemo(() => replayCubeHistory(payload.history, step), [payload.history, step]);
  const model = useMemo(() => buildCubeStructureRenderModel(state, [], payload.title), [state, payload.title]);
  const messages = useMemo<VoxelRendererMessages>(() => ({
    webglUnavailable: t("renderer.webglUnavailable"), contextLost: t("renderer.contextLost"),
    unrevealedCount: t("renderer.unrevealedCount"),
    formatProjection: (view) => t(`renderer.projections.${view}`),
    formatLayerCount: (label, count, visible) => count === null ? t("renderer.layerCountUnrevealed", { label })
      : t("renderer.layerCount", { label, count, visibility: visible ? t("renderer.visible") : t("renderer.hidden") }),
    formatTotalCount: (count) => t("renderer.totalCount", { count }),
    formatHiddenByLayerCount: (count) => t("renderer.hiddenByLayer", { count }),
    formatProjectedCell: (u, v, count) => count === null ? t("renderer.projectedCellUnrevealed", { u, v })
      : t("renderer.projectedCell", { u, v, count }),
  }), [t]);
  return <section className="flex size-full min-h-0 flex-col bg-paper" aria-label={payload.title}
    data-cube-courseware="cube-structures-lesson-v1" data-cube-courseware-step={step}>
    <div className="truncate px-3 py-1 text-sm text-ink">{payload.title}</div>
    <div className="min-h-0 flex-1">
      <CubeStructuresViewport model={model} messages={messages} materialColors={colors} readOnly
        cameraInteractive={preview} cameraRequestKey={step} hiddenEdgesVisible={state.hiddenEdgesVisible}
        sceneKey={payload.history.initial} onMovingChange={setMoving} opacityPreview={null} moveInteraction={null} cutInteraction={null}
        scene={{ state, tool: "orbit", cut: null, cutLines: [], cutConfirmation: null,
          annotation: { shape: "circle", placement: "side", color: CUBE_COLORS[0], value: state.nextNumber },
          face: null, ground: null, origin: state.origin, axesVisible: state.axesVisible,
          axisLength: Math.max(3, state.frame.radius * 1.5), validBuild: false, onGroundHover: noop, onGroundClick: noop }}
      />
    </div>
    {preview && <div className="flex flex-wrap items-center justify-center gap-2 border-t border-line p-2">
      <Button type="button" size="sm" variant="secondary" disabled={moving || step === 0} onClick={() => setCursor(step - 1)}>{t("teaching.previousStep")}</Button>
      <span className="text-xs text-muted" role="status">{labels("cubeStepCount", { step, count: payload.history.operations.length })}</span>
      <Button type="button" size="sm" variant="secondary" disabled={moving || step === payload.history.operations.length} onClick={() => setCursor(step + 1)}>{t("teaching.nextStep")}</Button>
    </div>}
  </section>;
}
