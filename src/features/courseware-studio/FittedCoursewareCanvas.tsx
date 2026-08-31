"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Fits a read-only courseware stage into the exact remaining workspace area.
 * Step 1 only needs sizing; editing, selection, and persistence stay outside
 * this leaf until the product layout is accepted.
 */
export function FittedCoursewareCanvas({
  aspect,
  children,
  className,
}: {
  aspect: number;
  children: ReactNode;
  className?: string;
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
      ref={hostRef}
      data-fitted-courseware-canvas
      className={cn("flex h-full min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-3", className)}
    >
      <div
        data-fitted-courseware-stage
        className="shrink-0 overflow-hidden bg-card"
        style={{
          width: size?.width ?? 0,
          height: size?.height ?? 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
