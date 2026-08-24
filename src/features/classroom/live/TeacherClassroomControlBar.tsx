"use client";

import type { ReactNode } from "react";

/** Fixed full-width M4b control row aligned to the teacher body's two columns. */
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
      className="fixed inset-x-3 bottom-[max(.5rem,env(safe-area-inset-bottom))] z-[70] grid h-14 grid-cols-[minmax(0,1fr)_clamp(22rem,31vw,36rem)] gap-3 rounded-2xl border border-line bg-paper/95 p-1.5 shadow-lg backdrop-blur"
      data-classroom-control-bar="full-width"
    >
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <div className="flex shrink-0 items-center gap-1.5">{secondaryControls}</div>
        <div className="ml-auto min-w-0 overflow-x-auto overscroll-contain">{drawingControls}</div>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1.5">{pageControls}</div>
    </footer>
  );
}
