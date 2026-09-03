"use client";

import { useMemo } from "react";
import {
  CoursewareNodeEditorHandles,
  CoursewareSnapGridOverlay,
  useCoursewareNodeTransform,
  type CoursewareNodeGeometry,
} from "./CoursewareNodeEditing";
import type {
  SourceRuntimeEditorBridgeNode,
  SourceRuntimeEditorCanvas,
  SourceRuntimeEditorGeometry,
} from "./source-runtime-editor";

function SelectedSourceNodeFrame({
  node,
  geometry,
  canvas,
  frameScale,
  snapToGrid,
  focused,
  moveLabel,
  resizeLabel,
  onPreview,
  onCommit,
}: {
  node: SourceRuntimeEditorBridgeNode;
  geometry: SourceRuntimeEditorGeometry;
  canvas: SourceRuntimeEditorCanvas;
  frameScale: number;
  snapToGrid: boolean;
  focused: boolean;
  moveLabel: string;
  resizeLabel: string;
  onPreview: (patch: CoursewareNodeGeometry) => void;
  onCommit: (patch: CoursewareNodeGeometry) => void;
}) {
  const measured = geometry.nodes.find((item) => item.path === node.path);
  const stageScale = geometry.stage.width / Math.max(1, canvas.width);
  const source = useMemo<CoursewareNodeGeometry>(() => ({
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  }), [node.height, node.width, node.x, node.y]);
  const transform = useCoursewareNodeTransform({
    geometry: source,
    stageScale: Math.max(0.0001, frameScale * stageScale),
    snapToGrid,
    gridStep: {
      x: canvas.width / 12,
      y: canvas.height / 9,
    },
    onPreview,
    onCommit,
  });

  if (!measured || !node.visible) return null;
  const draft = transform.geometry;
  const frame = {
    left: measured.left + (draft.x - source.x) * stageScale,
    top: measured.top + (draft.y - source.y) * stageScale,
    width: Math.max(1, measured.width + (draft.width - source.width) * stageScale),
    height: Math.max(1, measured.height + (draft.height - source.height) * stageScale),
  };
  return (
    <>
      <CoursewareSnapGridOverlay
        visible={snapToGrid && transform.active}
        step={{
          x: geometry.stage.width / 12,
          y: geometry.stage.height / 9,
        }}
        style={{
          inset: "auto",
          left: geometry.stage.left,
          top: geometry.stage.top,
          width: geometry.stage.width,
          height: geometry.stage.height,
        }}
      />
      <div
        data-source-runtime-editor-selection
        data-node-path={node.path}
        style={{
          position: "absolute",
          left: frame.left,
          top: frame.top,
          width: frame.width,
          height: frame.height,
          zIndex: 2147483647,
          pointerEvents: "none",
          outline: `2px ${focused && !transform.active ? "dashed" : "solid"} #e76f78`,
          outlineOffset: 2,
        }}
      >
        <CoursewareNodeEditorHandles
          moveLabel={moveLabel}
          resizeLabel={resizeLabel}
          onMovePointerDown={(event) => transform.begin(event, "move")}
          onResizePointerDown={(event) => transform.begin(event, "resize")}
          onPointerMove={transform.move}
          onPointerUp={transform.finish}
          onPointerCancel={transform.cancel}
        />
      </div>
    </>
  );
}

/**
 * Shared host-side authoring chrome for source runtimes. The iframe remains the
 * render authority; it reports geometry and text events but never draws a
 * second set of handles, outlines, or grids.
 */
export function SourceRuntimeEditorOverlay({
  editor,
  geometry,
  frameScale,
  focusedNodePath,
  onPreview,
}: {
  editor: {
    selectedNodePath: string | null;
    snapToGrid: boolean;
    canvas: SourceRuntimeEditorCanvas;
    nodes: SourceRuntimeEditorBridgeNode[];
    moveLabel: string;
    resizeLabel: string;
    onNodeTransformChange: (
      nodePath: string,
      patch: Partial<Pick<SourceRuntimeEditorBridgeNode, "x" | "y" | "width" | "height">>,
    ) => void;
  };
  geometry: SourceRuntimeEditorGeometry;
  frameScale: number;
  focusedNodePath: string | null;
  onPreview: (nodePath: string, patch: CoursewareNodeGeometry) => void;
}) {
  const selected = editor.nodes.find((node) => node.path === editor.selectedNodePath) ?? null;
  if (!selected) return null;
  return (
    <div
      data-source-runtime-editor-overlay
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: geometry.viewport.width,
        height: geometry.viewport.height,
        zIndex: 2147483647,
        pointerEvents: "none",
        transform: `scale(${frameScale})`,
        transformOrigin: "left top",
      }}
    >
      <SelectedSourceNodeFrame
        key={selected.path}
        node={selected}
        geometry={geometry}
        canvas={editor.canvas}
        frameScale={frameScale}
        snapToGrid={editor.snapToGrid}
        focused={focusedNodePath === selected.path}
        moveLabel={editor.moveLabel}
        resizeLabel={editor.resizeLabel}
        onPreview={(patch) => onPreview(selected.path, patch)}
        onCommit={(patch) => editor.onNodeTransformChange(selected.path, patch)}
      />
    </div>
  );
}
