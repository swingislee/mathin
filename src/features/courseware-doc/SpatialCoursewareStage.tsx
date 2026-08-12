"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  createInitialSpatialRuntimeState,
  type SpatialPageDoc,
} from "@/features/spatial-math/domain";
import {
  PolyhedronFoldView,
  VoxelView,
} from "@/features/spatial-math/renderer-r3f";

export interface SpatialCoursewareStageProps {
  readonly doc: SpatialPageDoc;
  readonly className?: string;
}

/**
 * SML-0 production read path. The page document is already immutable and hash-verified
 * before publication; this leaf only materializes its initial deterministic state.
 * Classroom command ownership is introduced in the later SML runtime increment.
 */
export default function SpatialCoursewareStage({ doc, className }: SpatialCoursewareStageProps) {
  const requestedLocale = useLocale();
  const locale = requestedLocale === "en" ? "en" : "zh";
  const state = useMemo(() => createInitialSpatialRuntimeState(doc), [doc]);
  const voxel = doc.scene.model.entities.find((entity) => entity.type === "voxel-set");
  const foldingPolyhedron = doc.scene.model.entities.find(
    (entity) => entity.type === "polyhedron" && entity.folding !== undefined,
  );
  const layoutClass = doc.layout.profile === "standard-4x3" ? "aspect-[4/3]" : "aspect-video";
  const summary = locale === "en"
    ? doc.scene.accessibility.summary.en ?? doc.scene.accessibility.summary.zh
    : doc.scene.accessibility.summary.zh;

  if (voxel) {
    return (
      <VoxelView
        page={doc}
        state={state}
        entityId={voxel.id}
        locale={locale}
        readOnly
        className={cn(layoutClass, className)}
        messages={{
          webglUnavailable: locale === "en" ? "3D is unavailable. Showing the orthographic view." : "3D 暂不可用，正在显示正投影视图。",
          contextLost: locale === "en" ? "The 3D context was interrupted. Showing the orthographic view." : "3D 画布已中断，正在显示正投影视图。",
          unrevealedCount: locale === "en" ? "Not revealed" : "尚未揭示",
          formatProjection: (view) => locale === "en" ? `${view} view` : `${view === "front" ? "正" : view === "right" ? "右" : "俯"}视图`,
          formatLayerCount: (label, count, visible) => `${label} · ${visible && count !== null ? count : locale === "en" ? "hidden" : "隐藏"}`,
          formatTotalCount: (count) => locale === "en" ? `${count} unit cubes` : `${count} 个单位正方体`,
          formatHiddenByLayerCount: (count) => locale === "en" ? `${count} hidden by layers` : `${count} 个被分层隐藏`,
          formatProjectedCell: (u, v, stackSize) => locale === "en"
            ? `Cell ${u}, ${v}${stackSize === null ? "" : `, stack ${stackSize}`}`
            : `格 ${u}, ${v}${stackSize === null ? "" : `，重叠 ${stackSize}`}`,
        }}
      />
    );
  }

  if (foldingPolyhedron) {
    const progress = state.netFoldProgress.find((entry) => entry.entityId === foldingPolyhedron.id)?.progress ?? 0;
    return (
      <PolyhedronFoldView
        scene={doc.scene}
        entityId={foldingPolyhedron.id}
        progress={progress}
        cameraId={state.cameraBookmarkId}
        locale={locale}
        readOnly
        className={cn(layoutClass, className)}
        messages={{
          webglUnavailable: locale === "en" ? "3D is unavailable. Showing the net." : "3D 暂不可用，正在显示展开图。",
          contextLost: locale === "en" ? "The 3D context was interrupted. Showing the net." : "3D 画布已中断，正在显示展开图。",
        }}
      />
    );
  }

  return (
    <section
      className={cn("grid w-full place-items-center overflow-hidden rounded-2xl border border-line bg-paper p-8", layoutClass, className)}
      data-layout-profile={doc.layout.profile}
      aria-label={summary}
    >
      <p className="max-w-prose text-center text-sm leading-relaxed text-muted">{summary}</p>
    </section>
  );
}
