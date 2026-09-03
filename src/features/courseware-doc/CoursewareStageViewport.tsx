"use client";

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared aspect-correct stage viewport for preview, formal authoring and
 * teacher-microcourse authoring. Rendering stays with StagePreview (or the
 * composition renderer); this leaf only owns fitting into the available box.
 */
export function CoursewareStageViewport({
  aspect,
  children,
  align = "center",
  className,
  stageClassName,
  hostProps,
  stageProps,
}: {
  aspect: number;
  children: ReactNode;
  align?: "start" | "center";
  className?: string;
  stageClassName?: string;
  hostProps?: HTMLAttributes<HTMLDivElement>;
  stageProps?: HTMLAttributes<HTMLDivElement>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const fit = () => {
      const style = window.getComputedStyle(host);
      const horizontalPadding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      const verticalPadding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
      const availableWidth = Math.max(0, host.clientWidth - horizontalPadding);
      const availableHeight = Math.max(0, host.clientHeight - verticalPadding);
      const width = Math.floor(Math.min(availableWidth, availableHeight * aspect));
      const height = Math.floor(width / aspect);
      setSize((current) => current?.width === width && current.height === height ? current : { width, height });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    fit();
    return () => observer.disconnect();
  }, [aspect]);

  return (
    <div
      {...hostProps}
      ref={hostRef}
      data-courseware-stage-viewport
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 justify-center overflow-hidden",
        align === "start" ? "items-start" : "items-center",
        className,
        hostProps?.className,
      )}
    >
      <div
        {...stageProps}
        data-courseware-stage-frame
        className={cn("shrink-0 overflow-hidden bg-card", stageClassName, stageProps?.className)}
        style={{
          ...stageProps?.style,
          width: size?.width ?? "100%",
          height: size?.height ?? "auto",
          aspectRatio: String(aspect),
        }}
      >
        {children}
      </div>
    </div>
  );
}
