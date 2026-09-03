"use client";

import { type HTMLAttributes, type ReactNode } from "react";
import { useCoursewareEditorChrome } from "./CoursewareEditorWorkbench";
import { CoursewareStageViewport } from "./CoursewareStageViewport";

type EditorDivAttributes = HTMLAttributes<HTMLDivElement> & {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

/**
 * Shared authoring surface used by every editable courseware adapter.
 * Adapters provide domain state and controls; this component alone mounts the
 * top toolbar, save state, inspector and aspect-fitted stage into the workbench.
 */
export function CoursewareEditorAdapterSurface({
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
  toolbar: ReactNode;
  saveControls: ReactNode;
  inspectorHeader?: ReactNode;
  inspector: ReactNode;
  aspect: number;
  children: ReactNode;
  className?: string;
  stageClassName?: string;
  hostProps?: EditorDivAttributes;
  stageProps?: EditorDivAttributes;
}) {
  useCoursewareEditorChrome({ toolbar, saveControls, inspectorHeader, inspector });

  return (
    <CoursewareStageViewport
      aspect={aspect}
      className={className}
      stageClassName={stageClassName}
      hostProps={hostProps}
      stageProps={stageProps}
    >
      {children}
    </CoursewareStageViewport>
  );
}
