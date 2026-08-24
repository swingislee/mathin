"use client";

import type { ReactNode } from "react";

/** Fixed full-width M4b flat rail aligned to the teacher body's two columns. */
export function TeacherClassroomControlBar({
  secondaryControls,
  drawingControls,
  pageControls,
}: {
  secondaryControls: ReactNode;
  drawingControls: ReactNode;
  pageControls: ReactNode;
}) {
  return (
    <footer
      className="fixed inset-x-0 bottom-0 z-[70] grid h-[calc(3.5rem+env(safe-area-inset-bottom))] grid-cols-[minmax(0,1fr)_clamp(22rem,31vw,36rem)] items-center gap-3 border-t border-line bg-paper/95 px-3 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      data-classroom-control-bar="full-width"
      data-classroom-control-surface="flat-rail"
    >
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <div className="flex shrink-0 items-center gap-1.5">{secondaryControls}</div>
        <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-line" />
        <div className="ml-auto min-w-0 overflow-x-auto overscroll-contain">{drawingControls}</div>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1.5 border-l border-line pl-3">{pageControls}</div>
    </footer>
  );
}
