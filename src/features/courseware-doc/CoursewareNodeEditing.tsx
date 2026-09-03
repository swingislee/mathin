"use client";

import {
  useCallback,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Grip, MoveDiagonal2 } from "lucide-react";

export interface CoursewareNodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CoursewareNodeTransformGesture {
  mode: "move" | "resize";
  pointerId: number;
  startX: number;
  startY: number;
  origin: CoursewareNodeGeometry;
}

export function coursewareNodeTransformGeometry({
  mode,
  origin,
  deltaX,
  deltaY,
  snapToGrid,
  gridStep,
}: {
  mode: CoursewareNodeTransformGesture["mode"];
  origin: CoursewareNodeGeometry;
  deltaX: number;
  deltaY: number;
  snapToGrid: boolean;
  gridStep: { x: number; y: number };
}): CoursewareNodeGeometry {
  const snap = (value: number, step: number) => (
    snapToGrid && step > 0 ? Math.round(value / step) * step : value
  );
  return mode === "move"
    ? {
        ...origin,
        x: snap(origin.x + deltaX, gridStep.x),
        y: snap(origin.y + deltaY, gridStep.y),
      }
    : {
        ...origin,
        width: Math.max(8, snap(origin.width + deltaX, gridStep.x)),
        height: Math.max(8, snap(origin.height + deltaY, gridStep.y)),
      };
}

export function useCoursewareNodeTransform({
  geometry,
  stageScale,
  snapToGrid,
  gridStep,
  onPreview,
  onCommit,
  onGestureChange,
}: {
  geometry: CoursewareNodeGeometry;
  stageScale: number;
  snapToGrid: boolean;
  gridStep: { x: number; y: number };
  onPreview?: (geometry: CoursewareNodeGeometry) => void;
  onCommit: (geometry: CoursewareNodeGeometry) => void;
  onGestureChange?: (active: boolean) => void;
}) {
  const [gesture, setGesture] = useState<CoursewareNodeTransformGesture | null>(null);
  const [draft, setDraft] = useState<CoursewareNodeGeometry | null>(null);

  const begin = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    mode: CoursewareNodeTransformGesture["mode"],
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: geometry,
    });
    setDraft(null);
    onGestureChange?.(true);
  }, [geometry, onGestureChange]);

  const move = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!gesture || gesture.pointerId !== event.pointerId || stageScale <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    const deltaX = (event.clientX - gesture.startX) / stageScale;
    const deltaY = (event.clientY - gesture.startY) / stageScale;
    const next = coursewareNodeTransformGeometry({
      mode: gesture.mode,
      origin: gesture.origin,
      deltaX,
      deltaY,
      snapToGrid,
      gridStep: { x: gridStep.x, y: gridStep.y },
    });
    setDraft(next);
    onPreview?.(next);
  }, [gesture, gridStep.x, gridStep.y, onPreview, snapToGrid, stageScale]);

  const finish = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (draft) onCommit(draft);
    setGesture(null);
    setDraft(null);
    onGestureChange?.(false);
  }, [draft, gesture, onCommit, onGestureChange]);

  const cancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    onPreview?.(gesture.origin);
    setGesture(null);
    setDraft(null);
    onGestureChange?.(false);
  }, [gesture, onGestureChange, onPreview]);

  return {
    active: gesture !== null,
    geometry: draft ?? geometry,
    begin,
    move,
    finish,
    cancel,
  };
}

export function CoursewareNodeEditorHandles({
  moveLabel,
  resizeLabel,
  onMovePointerDown,
  onResizePointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  moveLabel?: string;
  resizeLabel?: string;
  onMovePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const common: CSSProperties = {
    position: "absolute",
    zIndex: 2147483647,
    display: "grid",
    placeItems: "center",
    border: "1px solid #fff",
    background: "#e76f78",
    color: "#fff",
    pointerEvents: "auto",
  };
  return (
    <>
      <button
        type="button"
        data-courseware-node-move-handle
        aria-label={moveLabel}
        title={moveLabel}
        onPointerDown={onMovePointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{
          ...common,
          left: 0,
          top: 0,
          width: 28,
          height: 24,
          borderRadius: "0 0 8px 0",
          cursor: "move",
        }}
      >
        <Grip size={15} />
      </button>
      <button
        type="button"
        data-courseware-node-resize-handle
        aria-label={resizeLabel}
        title={resizeLabel}
        onPointerDown={onResizePointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{
          ...common,
          right: 0,
          bottom: 0,
          width: 28,
          height: 28,
          borderRadius: "8px 0 0 0",
          cursor: "nwse-resize",
        }}
      >
        <MoveDiagonal2 size={15} />
      </button>
    </>
  );
}

export function CoursewareSnapGridOverlay({
  visible,
  step,
  style,
}: {
  visible: boolean;
  step: { x: number; y: number };
  style?: CSSProperties;
}) {
  if (!visible) return null;
  return (
    <div
      data-courseware-node-snap-grid
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 2147483646,
        pointerEvents: "none",
        backgroundImage: "linear-gradient(to right, rgb(111 139 72 / 0.32) 1px, transparent 1px), linear-gradient(to bottom, rgb(111 139 72 / 0.32) 1px, transparent 1px)",
        backgroundSize: `${step.x}px ${step.y}px`,
        ...style,
      }}
    />
  );
}
