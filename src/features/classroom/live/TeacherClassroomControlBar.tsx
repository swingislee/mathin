"use client";

import type { ReactNode } from "react";

/** Fixed optical-glass dock aligned to the teacher body's two columns. */
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
      className="fixed inset-x-3 bottom-2 z-[70] grid h-[calc(3.5rem+env(safe-area-inset-bottom))] grid-cols-[minmax(0,1fr)_clamp(22rem,31vw,36rem)] items-center gap-3 rounded-[1.4rem] bg-paper/30 px-3 pb-[env(safe-area-inset-bottom)] shadow-[inset_0_1px_0_rgba(255,255,255,0.24),inset_0_-1px_0_rgba(0,0,0,0.16),0_10px_32px_rgba(0,0,0,0.22)] ring-1 ring-inset ring-white/10 backdrop-blur-xl backdrop-saturate-150"
      data-classroom-control-bar="full-width"
      data-classroom-control-surface="flat-rail"
      data-classroom-control-background="optical-glass"
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
