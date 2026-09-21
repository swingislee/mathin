"use client";

import { SpatialActionButton } from "../spatial-interaction/SpatialActionButton";

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { VoxelRendererMessages } from "@/features/spatial-math/renderer-r3f/VoxelFallback";
import { CubeStructuresWorkbench } from "../spatial-lab/CubeStructuresWorkbench";
import { SpatialCanvasPanel, SpatialViewIcon } from "../spatial-interaction/SpatialWorkbenchControls";
import { cubeSessionScene, type CubeWorkbenchSession } from "../spatial-lab/cube-structures-session";
import type { CubeToolbarId } from "../spatial-lab/cube-structures-toolbar";
import { useToolSnapshot } from "../scenes/useToolSnapshot";
import { createProjectionInitial, projectionInitial, projectionSnapshot, PROJECTION_VIEWS, type ProjectionInitial, type ProjectionSnapshot } from "./projection-contract";
import { ProjectionScene } from "./ProjectionScene";

const toolbar: readonly CubeToolbarId[] = ["orbit", "pan", "select", "build", "remove", "color", "face", "move", "layer", "transparent", "mark", "number",
  "view-angle", "view-front", "view-left", "view-right", "view-top", "fit", "axis-snap", "axes", "undo", "redo", "reset"];

export function ProjectionWorkspace({ initial, onSnapshot, classroom, readOnly = false }: {
  initial?: ProjectionInitial; onSnapshot?: (snapshot: ProjectionInitial | null) => void; readOnly?: boolean;
  classroom?: { state?: ProjectionSnapshot; onChange?: (next: ProjectionSnapshot) => Promise<void> };
}) {
  const locale = useLocale() === "en" ? "en" : "zh";
  const t = useTranslations("tools.projection");
  const spatial = useTranslations("tools.spatialLab");
  const teaching = useTranslations("teacherMicrocourses");
  const origin = useMemo(() => projectionSnapshot(initial ?? createProjectionInitial()), [initial]);
  const host = useToolSnapshot(origin, classroom);
  const { update } = host;
  const [panel, setPanel] = useState(false);
  const snapshot = host.snapshot;
  const disabled = readOnly || host.publishing || Boolean(classroom && !classroom.onChange);
  const capture = useCallback((session: CubeWorkbenchSession | null) => {
    onSnapshot?.(session && !host.publishing ? projectionInitial(snapshot, cubeSessionScene(session)) : null);
  }, [onSnapshot, host.publishing, snapshot]);
  const runtime = useMemo(() => ({ snapshot: snapshot.cube,
    onChange: (cube: ProjectionSnapshot["cube"]) => update({ ...snapshot, cube }),
  }), [snapshot, update]);
  const messages = useMemo<VoxelRendererMessages>(() => ({
    webglUnavailable: spatial("renderer.webglUnavailable"), contextLost: spatial("renderer.contextLost"), unrevealedCount: spatial("renderer.unrevealedCount"),
    formatProjection: (view) => spatial(`renderer.projections.${view}`),
    formatLayerCount: (label, count, visible) => count === null ? spatial("renderer.layerCountUnrevealed", { label }) : spatial("renderer.layerCount", { label, count, visibility: visible ? spatial("renderer.visible") : spatial("renderer.hidden") }),
    formatTotalCount: (count) => spatial("renderer.totalCount", { count }), formatHiddenByLayerCount: (count) => spatial("renderer.hiddenByLayer", { count }),
    formatProjectedCell: (u, v, count) => count === null ? spatial("renderer.projectedCellUnrevealed", { u, v }) : spatial("renderer.projectedCell", { u, v, count }),
  }), [spatial]);
  return <section className="relative flex size-full min-h-0 flex-col" aria-label={t("title")} data-projection-workspace="v1">
    {host.failed && <p role="alert" className="absolute inset-x-2 top-12 z-50 bg-paper p-2 text-xs text-rose">{teaching("spatialClassroomSyncError")}</p>}
    <CubeStructuresWorkbench locale={locale} rendererMessages={messages} onSnapshot={capture}
      cameraMessages={{ axisSnap: spatial("teaching.axisSnap"), enableAxisSnap: spatial("teaching.enableAxisSnap"), disableAxisSnap: spatial("teaching.disableAxisSnap") }}
      courseware={{ initial: origin.cube.session, toolbar, readOnly: disabled, runtime, resetLabel: teaching("cubeToolbarReset"), resetHint: teaching("cubeClassroomOriginHint"),
        onReset: () => host.update({ ...structuredClone(origin), cube: { ...structuredClone(origin.cube), cameraRevision: snapshot.cube.cameraRevision + 1 } }) }}
      extension={{ onToolChange: () => setPanel(false),
        renderScene: (state) => <ProjectionScene state={state} views={snapshot.views} guides={snapshot.guides} />,
        toolbar: (closePanel) => <SpatialActionButton action="projection" label={t("settings")} active={panel} disabled={disabled} onClick={() => { closePanel(); setPanel(!panel); }} />,
        panel: panel && <SpatialCanvasPanel title={t("settings")} closeLabel={t("close")} onClose={() => setPanel(false)}>
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap gap-1">{PROJECTION_VIEWS.map((view) => <Button key={view} size="sm" variant={snapshot.views.includes(view) ? "secondary" : "ghost"}
              aria-pressed={snapshot.views.includes(view)} disabled={disabled} onClick={() => host.update({ ...snapshot, views: snapshot.views.includes(view) ? snapshot.views.filter((item) => item !== view) : PROJECTION_VIEWS.filter((item) => item === view || snapshot.views.includes(item)) })}>
              <span className="size-4"><SpatialViewIcon view={view} /></span>{t(view)}
            </Button>)}</div>
            <Button size="sm" variant={snapshot.guides ? "secondary" : "ghost"} aria-pressed={snapshot.guides} disabled={disabled}
              onClick={() => host.update({ ...snapshot, guides: !snapshot.guides })}>{t("guides")}</Button>
            <p className="leading-5 text-muted">{t("hint")}</p>
          </div>
        </SpatialCanvasPanel>,
      }} />
  </section>;
}

export function ProjectionTool() {
  return <div className="flex h-full min-h-80 flex-1"><ProjectionWorkspace /></div>;
}
