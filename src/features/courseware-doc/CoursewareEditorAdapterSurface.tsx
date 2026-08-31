"use client";

import {
  useEffect,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CoursewareStageViewport } from "./CoursewareStageViewport";

interface EditorTargets {
  toolbar: HTMLElement | null;
  save: HTMLElement | null;
  inspectorHeader: HTMLElement | null;
  inspector: HTMLElement | null;
}

type EditorDivAttributes = HTMLAttributes<HTMLDivElement> & {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

/**
 * Shared authoring surface used by every editable courseware adapter.
 * Adapters provide domain state and controls; this component alone mounts the
 * top toolbar, save state, inspector and aspect-fitted stage into the workbench.
 */
export function CoursewareEditorAdapterSurface({
  toolbarTargetId,
  saveTargetId,
  inspectorHeaderTargetId,
  inspectorTargetId,
  toolbar,
  saveControls,
  inspectorHeader,
  inspector,
  aspect,
  children,
  className,
  stageClassName,
  hostProps,
  stageProps,
}: {
  toolbarTargetId: string;
  saveTargetId: string;
  inspectorHeaderTargetId: string;
  inspectorTargetId: string;
  toolbar: ReactNode;
  saveControls: ReactNode;
  inspectorHeader: ReactNode;
  inspector: ReactNode;
  aspect: number;
  children: ReactNode;
  className?: string;
  stageClassName?: string;
  hostProps?: EditorDivAttributes;
  stageProps?: EditorDivAttributes;
}) {
  const [targets, setTargets] = useState<EditorTargets>({
    toolbar: null,
    save: null,
    inspectorHeader: null,
    inspector: null,
  });

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setTargets({
        toolbar: document.getElementById(toolbarTargetId),
        save: document.getElementById(saveTargetId),
        inspectorHeader: document.getElementById(inspectorHeaderTargetId),
        inspector: document.getElementById(inspectorTargetId),
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [inspectorHeaderTargetId, inspectorTargetId, saveTargetId, toolbarTargetId]);

  return (
    <>
      {targets.toolbar ? createPortal(toolbar, targets.toolbar) : null}
      {targets.save ? createPortal(saveControls, targets.save) : null}
      {targets.inspectorHeader ? createPortal(inspectorHeader, targets.inspectorHeader) : null}
      {targets.inspector ? createPortal(inspector, targets.inspector) : null}
      <CoursewareStageViewport
        aspect={aspect}
        className={className}
        stageClassName={stageClassName}
        hostProps={hostProps}
        stageProps={stageProps}
      >
        {children}
      </CoursewareStageViewport>
    </>
  );
}
