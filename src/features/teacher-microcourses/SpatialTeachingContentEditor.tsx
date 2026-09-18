"use client";

import { useCallback } from "react";
import { ToolSceneEditor, ToolSceneSettings } from "@/features/tools/scenes/ToolSceneEditor";
import type { ToolScene } from "@/features/tools/scenes/contract";
import { isSpatialTeachingTool, type SpatialTeachingTool } from "@/features/tools/courseware/spatial-teaching-content";

export type SpatialTeachingVersion = SpatialTeachingTool["contentVersion"];

/** 历史导入路径继续可用；备课布局和保存均由 Tools 共用宿主维护。 */
export function SpatialTeachingContentEditor({ version, existing, onReady }: {
  version: SpatialTeachingVersion; existing?: SpatialTeachingTool; onReady: (tool: SpatialTeachingTool | null) => void;
}) {
  const capture = useCallback((scene: ToolScene | null) => onReady(scene && isSpatialTeachingTool(scene) ? scene : null), [onReady]);
  return <ToolSceneEditor version={version} existing={existing} onReady={capture} />;
}
export function SpatialTeachingSettings({ tool, onChange }: { tool: SpatialTeachingTool; onChange: (tool: SpatialTeachingTool) => void }) {
  return <ToolSceneSettings scene={tool} onChange={(scene) => { if (isSpatialTeachingTool(scene)) onChange(scene); }} />;
}
