"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { VoxelRendererMessages } from "@/features/spatial-math/renderer-r3f/VoxelFallback";
import { CubeStructuresViewport } from "../spatial-lab/CubeStructuresViewport";
import { CubeStructuresWorkbench } from "../spatial-lab/CubeStructuresWorkbench";
import { cubeCoursewareInitialSession, type CubeClassroomSnapshot, type CubeCoursewareRuntime } from "./cube-structures-classroom";
import { buildCubeStructureRenderModel, CUBE_COLORS, replayCubeHistory } from "../spatial-lab/cube-structures-contract";
import type { CubeCoursewarePayload } from "./cube-structures-content";

const colors = Object.fromEntries(CUBE_COLORS.map((color) => [color, color]));
const noop = () => {};

/** 编辑预览只试用固定副本；课堂由版本化事件流控制，与账号草稿分离。 */
export function CubeStructuresCourseware({ payload, preview = false, classroom }: {
  payload: CubeCoursewarePayload; preview?: boolean; classroom?: CubeCoursewareRuntime;
}) {
  const t = useTranslations("tools.spatialLab");
  const locale = useLocale() === "en" ? "en" : "zh";
  const labels = useTranslations("teacherMicrocourses");
  const [cursor, setCursor] = useState(0);
  const [moving, setMoving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const pending = useRef(false);
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
  const initial = useMemo(() => cubeCoursewareInitialSession(payload), [payload]);
  const snapshot = useMemo<CubeClassroomSnapshot>(() => classroom?.state ?? { session: initial, view: null, cameraRevision: 0 }, [classroom?.state, initial]);
  const runtime = useMemo(() => classroom ? { snapshot, onChange: (next: CubeClassroomSnapshot) => {
    if (!classroom.onChange || pending.current) return false;
    pending.current = true; setPublishing(true); setSyncError(false);
    void classroom.onChange(next).catch(() => setSyncError(true)).finally(() => { pending.current = false; setPublishing(false); });
    return true;
  } } : undefined, [classroom, snapshot]);
  if ("toolbar" in payload) return <section className="flex size-full min-h-0 flex-col bg-paper" aria-label={payload.title} data-cube-courseware="cube-structures-lesson-v2">
    {syncError && <p role="alert" className="px-3 text-sm text-rose">{labels("cubeClassroomSyncError")}</p>}
    <CubeStructuresWorkbench key={JSON.stringify(payload)} locale={locale} rendererMessages={messages}
      cameraMessages={{ axisSnap: t("teaching.axisSnap"), enableAxisSnap: t("teaching.enableAxisSnap"), disableAxisSnap: t("teaching.disableAxisSnap") }}
      courseware={{ initial, toolbar: payload.toolbar, runtime, readOnly: classroom ? !classroom.onChange || publishing : !preview,
        resetLabel: labels("cubeToolbarReset"), resetHint: labels("cubeClassroomOriginHint") }} />
  </section>;
  return <section className="flex size-full min-h-0 flex-col bg-paper" aria-label={payload.title}
    data-cube-courseware="cube-structures-lesson-v1" data-cube-courseware-step={step}>
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
