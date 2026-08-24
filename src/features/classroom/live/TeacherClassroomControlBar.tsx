"use client";

import type { ReactNode } from "react";

/** Fixed full-width M4b flat rail aligned to the teacher body's two columns. */
export function TeacherClassroomControlBar({
  inputControls,
  drawingControls,
  pageControls,
  utilityControls,
}: {
  inputControls: ReactNode;
  drawingControls: ReactNode;
  pageControls: ReactNode;
  utilityControls: ReactNode;
}) {
  return (
    <footer
      className="fixed inset-x-0 bottom-0 z-[70] grid h-[calc(3.5rem+env(safe-area-inset-bottom))] grid-cols-[minmax(0,1fr)_clamp(22rem,31vw,36rem)] items-center gap-3 border-t border-line bg-paper/95 px-3 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      data-classroom-control-bar="full-width"
      data-classroom-control-surface="flat-rail"
    >
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <div className="flex shrink-0 items-center gap-1.5" data-classroom-control-zone="input">{inputControls}</div>
        <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-line" />
        <div className="ml-auto min-w-0 touch-pan-x overflow-x-auto overflow-y-hidden overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {drawingControls}
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1.5 border-l border-line pl-3">
        <div className="flex shrink-0 items-center" data-classroom-control-zone="pages">{pageControls}</div>
        <span aria-hidden className="h-6 w-px shrink-0 bg-line" />
        <div className="flex shrink-0 items-center" data-classroom-control-zone="utility">{utilityControls}</div>
      </div>
    </footer>
  );
}
